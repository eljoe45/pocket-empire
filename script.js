// Pocket Empire — a tiny turn-based strategy game.
// Inspired by old "lite" mobile 4X games: grow a city, research tech,
// build an army, and beat a rival empire by conquest or development.

document.getElementById('year').textContent = new Date().getFullYear();

// ---- Config ---------------------------------------------------------------

const COLS = 9;
const ROWS = 9;
const TURN_LIMIT = 50;

const UNIT_TYPES = {
  warrior: { name: 'Warrior', icon: '⚔️', cost: 10, atk: 3, def: 2, hp: 10, move: 1, range: 1, requires: null },
  archer: { name: 'Archer', icon: '🏹', cost: 14, atk: 4, def: 1, hp: 8, move: 1, range: 2, requires: 'archery' },
  knight: { name: 'Knight', icon: '🐎', cost: 20, atk: 6, def: 2, hp: 14, move: 2, range: 1, requires: 'riding' },
};

const BUILDING_TYPES = {
  library: { name: 'Library', icon: '📚', cost: 12, desc: '+1 science per turn', requires: null, flag: 'hasLibrary' },
  walls: { name: 'Walls', icon: '🧱', cost: 18, desc: '+8 city HP, +2 defense', requires: 'masonry', flag: 'hasWalls' },
  market: { name: 'Market', icon: '💰', cost: 16, desc: '+2 production per turn', requires: 'currency', flag: 'hasMarket' },
};

const GROW = { name: 'Grow city', icon: '🏗️', cost: 15, desc: '+1 city level: more production & HP, fully heals the city' };

const TECHS = [
  { id: 'archery', name: 'Archery', desc: 'Unlocks the Archer, a ranged unit that strikes without being hit back.', threshold: 10 },
  { id: 'masonry', name: 'Masonry', desc: 'Unlocks Walls: extra city HP and defense.', threshold: 20 },
  { id: 'currency', name: 'Currency', desc: 'Unlocks the Market: extra production every turn.', threshold: 32 },
  { id: 'riding', name: 'Riding', desc: 'Unlocks the Knight, a fast, hard-hitting unit.', threshold: 46 },
];

// ---- State ------------------------------------------------------------

let state = null;
let nextId = 1;

// ---- Map generation ---------------------------------------------------

function randomTileType() {
  const r = Math.random();
  if (r < 0.55) return 'plains';
  if (r < 0.75) return 'forest';
  if (r < 0.90) return 'hills';
  return 'water';
}

function clearArea(tiles, pos) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = pos.x + dx, y = pos.y + dy;
      if (x < 0 || x >= COLS || y < 0 || y >= ROWS) continue;
      tiles[y][x] = 'plains';
    }
  }
}

function generateMap() {
  const tiles = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) row.push(randomTileType());
    tiles.push(row);
  }
  const playerPos = { x: 1, y: ROWS - 2 };
  const aiPos = { x: COLS - 2, y: 1 };
  clearArea(tiles, playerPos);
  clearArea(tiles, aiPos);
  return { tiles, playerPos, aiPos };
}

// ---- Helpers ---------------------------------------------------------

function distChebyshev(x1, y1, x2, y2) {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

function tileDefBonus(type) {
  if (type === 'hills') return 2;
  if (type === 'forest') return 1;
  return 0;
}

function cityAt(x, y) {
  if (state.cities.player.x === x && state.cities.player.y === y && !state.cities.player.captured) return state.cities.player;
  if (state.cities.ai.x === x && state.cities.ai.y === y && !state.cities.ai.captured) return state.cities.ai;
  return null;
}

function occupied(x, y) {
  if (state.units.some(u => u.x === x && u.y === y)) return true;
  if (cityAt(x, y)) return true;
  return false;
}

function findSpawnTile(nearX, nearY) {
  for (let r = 0; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = nearX + dx, y = nearY + dy;
        if (x < 0 || x >= COLS || y < 0 || y >= ROWS) continue;
        if (state.map.tiles[y][x] === 'water') continue;
        if (occupied(x, y)) continue;
        return { x, y };
      }
    }
  }
  return null;
}

function spawnUnit(owner, type, nearX, nearY) {
  const tpl = UNIT_TYPES[type];
  const spot = findSpawnTile(nearX, nearY);
  if (!spot) return null;
  const unit = {
    id: nextId++, owner, type, x: spot.x, y: spot.y,
    hp: tpl.hp, maxHp: tpl.hp, atk: tpl.atk, def: tpl.def,
    move: tpl.move, range: tpl.range, acted: false,
  };
  state.units.push(unit);
  return unit;
}

function cityProduction(city) {
  return 3 + city.level * 2 + (city.hasMarket ? 2 : 0);
}

function cityScience(city) {
  return 1 + (city.hasLibrary ? 1 : 0);
}

function getBuildCost(build) {
  if (!build) return 0;
  if (build.kind === 'unit') return UNIT_TYPES[build.key].cost;
  if (build.kind === 'building') return BUILDING_TYPES[build.key].cost;
  return GROW.cost;
}

function buildLabel(build) {
  if (!build) return '';
  if (build.kind === 'unit') return UNIT_TYPES[build.key].name;
  if (build.kind === 'building') return BUILDING_TYPES[build.key].name;
  return GROW.name;
}

function labelFor(entity) {
  if (entity.type && UNIT_TYPES[entity.type]) {
    return `${entity.owner === 'player' ? 'Your' : "The rival's"} ${UNIT_TYPES[entity.type].name}`;
  }
  return entity.owner === 'player' ? 'your city' : 'the rival city';
}

function log(msg) {
  state.log.push(`Turn ${state.turn}: ${msg}`);
}

function setInfo(text) {
  document.getElementById('selectionInfo').textContent = text;
}

// ---- Game flow ---------------------------------------------------------

function initState() {
  const map = generateMap();
  nextId = 1;
  state = {
    turn: 1,
    map,
    cities: {
      player: { owner: 'player', x: map.playerPos.x, y: map.playerPos.y, level: 1, hp: 28, maxHp: 28, hasWalls: false, hasLibrary: false, hasMarket: false, build: null, stock: 0, captured: false },
      ai: { owner: 'ai', x: map.aiPos.x, y: map.aiPos.y, level: 1, hp: 28, maxHp: 28, hasWalls: false, hasLibrary: false, hasMarket: false, build: null, stock: 0, captured: false },
    },
    units: [],
    tech: { player: { science: 0, unlocked: new Set() }, ai: { science: 0, unlocked: new Set() } },
    selected: null,
    log: [],
    over: false,
  };
  spawnUnit('player', 'warrior', state.cities.player.x, state.cities.player.y);
  spawnUnit('ai', 'warrior', state.cities.ai.x, state.cities.ai.y);
  log('A new empire rises. Good luck!');
}

function startNewGame() {
  document.getElementById('endModal').classList.add('hidden');
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('gameScreen').classList.remove('hidden');
  initState();
  render();
}

function checkTechUnlocks(side) {
  const t = state.tech[side];
  TECHS.forEach(tech => {
    if (!t.unlocked.has(tech.id) && t.science >= tech.threshold) {
      t.unlocked.add(tech.id);
      if (side === 'player') log(`Research complete: ${tech.name}!`);
    }
  });
}

function completeBuild(side, city) {
  const b = city.build;
  const whose = side === 'player' ? 'Your' : "The rival's";
  if (b.kind === 'unit') {
    spawnUnit(side, b.key, city.x, city.y);
    log(`${whose} city finished training a ${UNIT_TYPES[b.key].name}.`);
  } else if (b.kind === 'building') {
    const def = BUILDING_TYPES[b.key];
    city[def.flag] = true;
    if (b.key === 'walls') { city.maxHp += 8; city.hp += 8; }
    log(`${whose} city built ${def.name}.`);
  } else if (b.kind === 'grow') {
    city.level += 1;
    city.maxHp = 20 + city.level * 8 + (city.hasWalls ? 8 : 0);
    city.hp = city.maxHp;
    log(`${whose} city grew to level ${city.level}.`);
  }
  city.build = null;
}

function aiChooseBuild(city) {
  const t = state.tech.ai;
  const aiUnitCount = state.units.filter(u => u.owner === 'ai').length;
  if (!city.hasWalls && t.unlocked.has('masonry')) {
    city.build = { kind: 'building', key: 'walls' };
  } else if (!city.hasLibrary && state.turn < 15) {
    city.build = { kind: 'building', key: 'library' };
  } else if (aiUnitCount < 2 + Math.floor(state.turn / 8)) {
    let key = 'warrior';
    if (t.unlocked.has('riding')) key = 'knight';
    else if (t.unlocked.has('archery') && Math.random() < 0.5) key = 'archer';
    city.build = { kind: 'unit', key };
  } else if (!city.hasMarket && t.unlocked.has('currency')) {
    city.build = { kind: 'building', key: 'market' };
  } else {
    city.build = { kind: 'grow' };
  }
}

function tickCity(side) {
  const city = state.cities[side];
  if (!city || city.captured) return;
  if (!city.build && side === 'ai') aiChooseBuild(city);
  city.stock += cityProduction(city);
  state.tech[side].science += cityScience(city);
  if (city.build) {
    const cost = getBuildCost(city.build);
    if (city.stock >= cost) {
      city.stock -= cost;
      completeBuild(side, city);
    }
  }
}

function resolveAttack(attacker, defender, isCity) {
  const ranged = attacker.range > 1;
  if (isCity) {
    const defBonus = (defender.hasWalls ? 2 : 0) + tileDefBonus(state.map.tiles[defender.y][defender.x]);
    const dmg = Math.max(1, attacker.atk - defBonus);
    defender.hp -= dmg;
    log(`${labelFor(attacker)} hits ${labelFor(defender)} for ${dmg}.`);
    if (defender.hp <= 0) {
      defender.hp = 0;
      defender.captured = true;
      log(`${defender.owner === 'player' ? 'Your' : "The rival's"} city has fallen!`);
    }
    return;
  }
  const defBonus = defender.def + tileDefBonus(state.map.tiles[defender.y][defender.x]);
  const dmg = Math.max(1, attacker.atk - defBonus);
  defender.hp -= dmg;
  log(`${labelFor(attacker)} hits ${labelFor(defender)} for ${dmg}.`);
  if (defender.hp <= 0) {
    log(`${labelFor(defender)} is destroyed.`);
    state.units = state.units.filter(u => u !== defender);
  } else if (!ranged) {
    const counterDef = attacker.def + tileDefBonus(state.map.tiles[attacker.y][attacker.x]);
    const counterDmg = Math.max(1, defender.atk - counterDef);
    attacker.hp -= counterDmg;
    log(`${labelFor(defender)} strikes back for ${counterDmg}.`);
    if (attacker.hp <= 0) {
      log(`${labelFor(attacker)} is destroyed.`);
      state.units = state.units.filter(u => u !== attacker);
    }
  }
}

function powerScore(side) {
  const city = state.cities[side];
  let score = city.captured ? 0 : (city.level * 10 + (city.hasWalls ? 5 : 0) + (city.hasLibrary ? 3 : 0) + (city.hasMarket ? 5 : 0));
  score += state.units.filter(u => u.owner === side).reduce((sum, u) => sum + u.atk + u.hp / 2, 0);
  score += state.tech[side].unlocked.size * 6;
  return Math.round(score);
}

function finishGame(result, message) {
  state.over = true;
  document.getElementById('endTitle').textContent = result === 'win' ? 'Victory!' : 'Defeat';
  document.getElementById('endMessage').textContent = message;
  document.getElementById('endModal').classList.remove('hidden');
}

function endGameByScore() {
  const p = powerScore('player'), a = powerScore('ai');
  if (p >= a) finishGame('win', `Turn limit reached. Your empire (score ${p}) outgrew the rival's (score ${a}). Victory through development!`);
  else finishGame('lose', `Turn limit reached. The rival empire (score ${a}) outgrew yours (score ${p}).`);
}

function checkGameOver() {
  if (state.cities.ai.captured) finishGame('win', 'You captured the rival capital! Victory through conquest.');
  else if (state.cities.player.captured) finishGame('lose', 'Your capital has fallen. The rival empire wins.');
}

function aiActUnit(u) {
  const targets = [...state.units.filter(t => t.owner === 'player'), state.cities.player].filter(t => !t.captured);
  if (targets.length === 0) { u.acted = true; return; }
  let nearest = null, nearestDist = Infinity;
  targets.forEach(t => {
    const d = distChebyshev(u.x, u.y, t.x, t.y);
    if (d < nearestDist) { nearestDist = d; nearest = t; }
  });
  const range = Math.max(u.range, 1);
  if (nearestDist <= range) {
    resolveAttack(u, nearest, nearest === state.cities.player);
    u.acted = true;
    checkGameOver();
    return;
  }
  let steps = u.move;
  while (steps > 0) {
    const dx = Math.sign(nearest.x - u.x), dy = Math.sign(nearest.y - u.y);
    const options = [{ x: u.x + dx, y: u.y + dy }, { x: u.x + dx, y: u.y }, { x: u.x, y: u.y + dy }]
      .filter(p => p.x !== u.x || p.y !== u.y);
    let moved = false;
    for (const opt of options) {
      if (opt.x < 0 || opt.x >= COLS || opt.y < 0 || opt.y >= ROWS) continue;
      if (state.map.tiles[opt.y][opt.x] === 'water') continue;
      if (occupied(opt.x, opt.y)) continue;
      u.x = opt.x; u.y = opt.y; moved = true; break;
    }
    if (!moved) break;
    steps--;
    const d = distChebyshev(u.x, u.y, nearest.x, nearest.y);
    if (d <= range) {
      resolveAttack(u, nearest, nearest === state.cities.player);
      u.acted = true;
      checkGameOver();
      return;
    }
  }
  u.acted = true;
}

function aiTurn() {
  const aiUnits = state.units.filter(u => u.owner === 'ai' && !u.acted);
  for (const u of aiUnits) {
    if (state.over) break;
    aiActUnit(u);
  }
}

function endTurn() {
  if (state.over) return;
  tickCity('player');
  checkTechUnlocks('player');
  state.selected = null;

  state.units.forEach(u => { if (u.owner === 'ai') u.acted = false; });
  aiTurn();
  if (state.over) { render(); return; }

  tickCity('ai');
  checkTechUnlocks('ai');
  if (state.over) { render(); return; }

  state.turn++;
  if (state.turn > TURN_LIMIT) {
    endGameByScore();
    render();
    return;
  }
  state.units.forEach(u => { if (u.owner === 'player') u.acted = false; });
  render();
}

// ---- Interaction ---------------------------------------------------------

function handleTileClick(x, y) {
  if (state.over) return;
  const tileType = state.map.tiles[y][x];
  const unitHere = state.units.find(u => u.x === x && u.y === y);
  const cityHere = cityAt(x, y);

  if (state.selected) {
    const selUnit = state.units.find(u => u.id === state.selected.unitId);
    if (!selUnit || selUnit.acted) { state.selected = null; render(); return; }

    if (x === selUnit.x && y === selUnit.y) {
      state.selected = null; render(); return;
    }

    const dist = distChebyshev(selUnit.x, selUnit.y, x, y);
    const targetIsEnemy = (unitHere && unitHere.owner !== selUnit.owner) || (cityHere && cityHere.owner !== selUnit.owner);

    if (targetIsEnemy) {
      if (dist <= Math.max(selUnit.range, 1)) {
        const wasCity = !!cityHere;
        resolveAttack(selUnit, unitHere || cityHere, wasCity);
        selUnit.acted = true;
        state.selected = null;
        checkGameOver();
        render();
      } else {
        setInfo('Too far to attack from here.');
      }
      return;
    }

    if (cityHere && cityHere.owner === 'player') {
      state.selected = null;
      openBuildModal();
      return;
    }

    if (unitHere && unitHere.owner === 'player' && !unitHere.acted) {
      state.selected = { unitId: unitHere.id };
      render();
      return;
    }

    if (!unitHere && !cityHere && tileType !== 'water' && dist <= selUnit.move) {
      selUnit.x = x; selUnit.y = y;
      selUnit.acted = true;
      state.selected = null;
      render();
      return;
    }

    setInfo("You can't move there.");
    return;
  }

  if (unitHere && unitHere.owner === 'player') {
    if (unitHere.acted) { setInfo('This unit has already acted this turn.'); return; }
    state.selected = { unitId: unitHere.id };
    render();
    return;
  }
  if (unitHere && unitHere.owner === 'ai') {
    setInfo(`Rival ${UNIT_TYPES[unitHere.type].name} — HP ${unitHere.hp}/${unitHere.maxHp}.`);
    return;
  }
  if (cityHere && cityHere.owner === 'player') {
    openBuildModal();
    return;
  }
  if (cityHere && cityHere.owner === 'ai') {
    setInfo(`That is the rival capital — HP ${cityHere.hp}/${cityHere.maxHp}.`);
    return;
  }
}

// ---- Rendering ---------------------------------------------------------

function render() {
  if (!state) return;
  document.getElementById('turnCounter').textContent = `Turn ${state.turn}`;
  document.getElementById('prodStat').textContent = cityProduction(state.cities.player);
  document.getElementById('sciStat').textContent = cityScience(state.cities.player);

  const board = document.getElementById('board');
  board.innerHTML = '';

  const selUnit = state.selected ? state.units.find(u => u.id === state.selected.unitId) : null;
  const reachable = new Set(), attackable = new Set();
  if (selUnit) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const d = distChebyshev(selUnit.x, selUnit.y, x, y);
        const unitHere = state.units.find(u => u.x === x && u.y === y);
        const cityHere = cityAt(x, y);
        const key = `${x},${y}`;
        const isEnemy = (unitHere && unitHere.owner !== selUnit.owner) || (cityHere && cityHere.owner !== selUnit.owner);
        if (isEnemy) {
          if (d <= Math.max(selUnit.range, 1)) attackable.add(key);
        } else if (!unitHere && !cityHere && state.map.tiles[y][x] !== 'water' && d > 0 && d <= selUnit.move) {
          reachable.add(key);
        }
      }
    }
  }

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const tileType = state.map.tiles[y][x];
      const key = `${x},${y}`;
      const cell = document.createElement('div');
      cell.className = `tile tile-${tileType}`;
      if (reachable.has(key)) cell.classList.add('tile-reachable');
      if (attackable.has(key)) cell.classList.add('tile-attackable');
      if (selUnit && selUnit.x === x && selUnit.y === y) cell.classList.add('tile-selected');

      const cityHere = cityAt(x, y);
      const unitHere = state.units.find(u => u.x === x && u.y === y);

      if (cityHere) {
        appendEntityIcon(cell, '🏰', cityHere.hp, cityHere.maxHp, false, false);
      } else if (unitHere) {
        appendEntityIcon(cell, UNIT_TYPES[unitHere.type].icon, unitHere.hp, unitHere.maxHp, unitHere.owner === 'ai', unitHere.acted);
      } else if (tileType === 'forest') {
        cell.textContent = '🌲';
      } else if (tileType === 'hills') {
        cell.textContent = '⛰️';
      } else if (tileType === 'water') {
        cell.textContent = '🌊';
      }

      cell.addEventListener('click', () => handleTileClick(x, y));
      board.appendChild(cell);
    }
  }

  renderSelectionInfo(selUnit);
}

function appendEntityIcon(cell, icon, hp, maxHp, isAi, acted) {
  const span = document.createElement('span');
  span.className = 'tile-unit' + (isAi ? ' is-ai' : '') + (acted ? ' is-acted' : '');
  span.textContent = icon;
  cell.appendChild(span);

  const bar = document.createElement('div');
  bar.className = 'hp-bar';
  const fill = document.createElement('div');
  const pct = Math.max(0, hp / maxHp * 100);
  fill.className = 'hp-bar-fill' + (hp / maxHp < 0.35 ? ' is-low' : '');
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  cell.appendChild(bar);
}

function renderSelectionInfo(selUnit) {
  if (selUnit) {
    const t = UNIT_TYPES[selUnit.type];
    setInfo(`${t.name} selected — HP ${selUnit.hp}/${selUnit.maxHp}, ATK ${t.atk}. Tap a highlighted tile.`);
  } else {
    setInfo('Tap a unit or your city (🏰) to begin.');
  }
}

function openBuildModal() {
  renderBuildModal();
  document.getElementById('buildModal').classList.remove('hidden');
}

function renderBuildModal() {
  const city = state.cities.player;
  document.getElementById('buildProgressLabel').textContent = city.build
    ? `Building ${buildLabel(city.build)} — ${city.stock}/${getBuildCost(city.build)} production (stockpile: ${city.stock})`
    : `Stockpiled production: ${city.stock}⚒️ — pick something to build.`;

  const items = [];
  Object.keys(UNIT_TYPES).forEach(key => {
    const t = UNIT_TYPES[key];
    items.push({
      kind: 'unit', key, name: t.name, icon: t.icon, cost: t.cost,
      desc: `ATK ${t.atk} · DEF ${t.def} · HP ${t.hp} · MOVE ${t.move}${t.range > 1 ? ` · RANGE ${t.range}` : ''}`,
      locked: t.requires && !state.tech.player.unlocked.has(t.requires),
    });
  });
  Object.keys(BUILDING_TYPES).forEach(key => {
    const b = BUILDING_TYPES[key];
    if (city[b.flag]) return;
    items.push({ kind: 'building', key, name: b.name, icon: b.icon, cost: b.cost, desc: b.desc, locked: b.requires && !state.tech.player.unlocked.has(b.requires) });
  });
  items.push({ kind: 'grow', key: 'grow', name: GROW.name, icon: GROW.icon, cost: GROW.cost, desc: GROW.desc, locked: false });

  const wrap = document.getElementById('buildOptions');
  wrap.innerHTML = '';
  items.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = city.build && city.build.kind === item.kind && city.build.key === item.key;
    btn.className = 'build-option' + (isActive ? ' is-active' : '');
    btn.disabled = !!item.locked;
    btn.innerHTML = `<span class="build-option-icon">${item.icon}</span>` +
      `<span class="build-option-body"><div class="build-option-name">${item.name}${item.locked ? ' (locked)' : ''}</div>` +
      `<div class="build-option-desc">${item.desc}</div></span>` +
      `<span class="build-option-cost">${item.cost}⚒️</span>`;
    btn.addEventListener('click', () => {
      if (item.locked) return;
      city.build = { kind: item.kind, key: item.key };
      renderBuildModal();
    });
    wrap.appendChild(btn);
  });
}

function openTechModal() {
  renderTechModal();
  document.getElementById('techModal').classList.remove('hidden');
}

function renderTechModal() {
  const sci = state.tech.player.science;
  document.getElementById('techProgressLabel').textContent = `Science: ${sci} accumulated (+${cityScience(state.cities.player)}/turn)`;
  const wrap = document.getElementById('techList');
  wrap.innerHTML = '';
  TECHS.forEach(t => {
    const unlocked = state.tech.player.unlocked.has(t.id);
    const pct = Math.min(100, sci / t.threshold * 100);
    const row = document.createElement('div');
    row.className = 'tech-row' + (unlocked ? ' is-unlocked' : '');
    row.innerHTML = `<div class="tech-row-top"><span>${t.name}</span><span>${unlocked ? 'Unlocked' : `${Math.min(sci, t.threshold)}/${t.threshold}`}</span></div>` +
      `<div class="tech-row-desc">${t.desc}</div>` +
      `<div class="tech-track"><div class="tech-track-fill" style="width:${pct}%"></div></div>`;
    wrap.appendChild(row);
  });
}

function openLogModal() {
  const wrap = document.getElementById('logList');
  wrap.innerHTML = '';
  [...state.log].reverse().slice(0, 40).forEach(entry => {
    const p = document.createElement('p');
    p.textContent = entry;
    wrap.appendChild(p);
  });
  document.getElementById('logModal').classList.remove('hidden');
}

// ---- Wiring ---------------------------------------------------------

document.getElementById('newGameBtn').addEventListener('click', startNewGame);
document.getElementById('restartBtn').addEventListener('click', startNewGame);
document.getElementById('endTurnBtn').addEventListener('click', endTurn);
document.getElementById('techBtn').addEventListener('click', openTechModal);
document.getElementById('logBtn').addEventListener('click', openLogModal);

document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.close).classList.add('hidden');
  });
});

document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
});

