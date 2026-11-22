import assert from 'node:assert/strict';
import { loadEngine } from './load-engine.mjs';

const { CONFIG, Locale, PRNG, HexGrid, Combat, MapGenerator, GameRules } = loadEngine();

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.stack || err.message}`);
  }
}

console.log('\n=== Heksagon: Jedinični testovi pravila (Node.js bez DOM-a) ===\n');

// 1. Topology & Map generation across 500 seeds
test('Heksagonalna mreža polumjera 5 ima točno 91 polje', () => {
  assert.equal(HexGrid.TOPOLOGY.count, 91);
  assert.equal(HexGrid.TOPOLOGY.coords.length, 91);
});

test('Generiranje mape na 500 različitih seedova (voda ~15%, povezanost, prijestolnice, neutralne jedinice)', () => {
  const SEED_COUNT = 500;
  for (let s = 0; s < SEED_COUNT; s++) {
    const seed = `TEST-MAP-${s}-${(s * 7919) % 10000}`;
    const map = MapGenerator.generateMap(seed);
    assert.equal(map.tiles.length, 91, `Seed ${seed}: expected 91 tiles`);

    // Water ratio around 15% (13-15 tiles out of 91)
    assert.ok(map.waterCount >= 12 && map.waterCount <= 16, `Seed ${seed}: waterCount ${map.waterCount}`);
    assert.equal(map.landCount + map.waterCount, 91);

    // Full land connectivity via independent BFS
    const waterFlags = map.tiles.map((t) => (t.isWater ? 1 : 0));
    assert.equal(HexGrid.isLandConnected(waterFlags), true, `Seed ${seed}: land is disconnected!`);

    // Capitals on opposite sides with 5 units each
    const hCap = map.tiles[map.humanCapId];
    const aCap = map.tiles[map.aiCapId];
    assert.equal(hCap.isWater, false);
    assert.equal(aCap.isWater, false);
    assert.equal(hCap.isCapital, true);
    assert.equal(aCap.isCapital, true);
    assert.equal(hCap.owner, CONFIG.PLAYERS.HUMAN);
    assert.equal(aCap.owner, CONFIG.PLAYERS.AI);
    assert.equal(hCap.units, 5);
    assert.equal(aCap.units, 5);
    assert.equal(hCap.q + aCap.q, 0);
    assert.equal(hCap.r + aCap.r, 0);
    assert.equal(HexGrid.distance(hCap, aCap), 8);

    // All non-capital land tiles are neutral with 1-3 units
    for (const t of map.tiles) {
      if (t.isWater) {
        assert.equal(t.owner, CONFIG.PLAYERS.NEUTRAL);
        assert.equal(t.units, 0);
      } else if (t.id !== map.humanCapId && t.id !== map.aiCapId) {
        assert.equal(t.owner, CONFIG.PLAYERS.NEUTRAL);
        assert.ok(t.units >= 1 && t.units <= 3, `Seed ${seed}: neutral units ${t.units}`);
      }
    }
  }
});

test('Determinizam seeda: isti seed daje identičnu mapu i identične ishode borbi', () => {
  const g1 = GameRules.createGame({ seed: 'JADRAN-777', difficulty: 'normal' });
  const g2 = GameRules.createGame({ seed: 'JADRAN-777', difficulty: 'normal' });
  assert.deepEqual(g1.tiles, g2.tiles);
  assert.deepEqual(g1.rng, g2.rng);

  // Place reinforcements identically and attack same neighbor
  let s1 = GameRules.placeReinforcement(g1, g1.capitals[1], 2).state;
  let s2 = GameRules.placeReinforcement(g2, g2.capitals[1], 2).state;
  const targets1 = GameRules.getValidTargets(s1, s1.capitals[1]);
  const targetId = targets1[0].tileId;
  const m1 = GameRules.executeMove(s1, s1.capitals[1], targetId, 6);
  const m2 = GameRules.executeMove(s2, s2.capitals[1], targetId, 6);
  assert.deepEqual(m1.combat.rounds, m2.combat.rounds);
  assert.deepEqual(m1.state.tiles, m2.state.tiles);
});

// 2. Combat & Exact Win Probability
test('Borba: pojedinačna runda (normalno 5/12, prijestolnica 5/18) i izjednačenje u korist branitelja', () => {
  assert.ok(Math.abs(Combat.singleRoundAttackerWinProb(false) - 15 / 36) < 1e-12);
  assert.ok(Math.abs(Combat.singleRoundAttackerWinProb(true) - 10 / 36) < 1e-12);

  // Check exact 1 vs 1 probabilities
  assert.ok(Math.abs(Combat.getWinProbability(1, 1, false) - 5 / 12) < 1e-12);
  assert.ok(Math.abs(Combat.getWinProbability(1, 1, true) - 5 / 18) < 1e-12);

  // Verify round-by-round tie and capital bonus rules directly
  let rng = PRNG.hashSeed('COMBAT-RULES-CHECK');
  for (let i = 0; i < 300; i++) {
    const isCap = i % 2 === 1;
    const res = Combat.resolveCombat(rng, 4, 3, isCap);
    rng = res.rng;
    let att = 4;
    let def = 3;
    for (const r of res.rounds) {
      assert.ok(r.attRoll >= 1 && r.attRoll <= 6);
      assert.ok(r.defRoll >= 1 && r.defRoll <= 6);
      assert.equal(r.defBonus, isCap ? 1 : 0);
      assert.equal(r.defTotal, r.defRoll + (isCap ? 1 : 0));
      const expectedAttWin = r.attRoll > r.defTotal; // strict > means tie goes to defender
      assert.equal(r.attackerWonRound, expectedAttWin);
      if (expectedAttWin) def--;
      else att--;
      assert.equal(r.attLeft, att);
      assert.equal(r.defLeft, def);
    }
    assert.ok((att > 0 && def === 0) || (att === 0 && def > 0));
    assert.equal(res.attackerWon, att > 0);
    assert.equal(res.attSurvivors, att);
    assert.equal(res.defSurvivors, def);
  }
});

test('Egzaktna DP vjerojatnost pobjede podudara se s Monte Carlo simulacijom (200.000 borbi)', () => {
  const cases = [
    { a: 3, d: 2, cap: false },
    { a: 6, d: 3, cap: false },
    { a: 8, d: 5, cap: true },
    { a: 11, d: 5, cap: true },
  ];
  const TRIALS = 50000; // 4 * 50,000 = 200,000 total combats
  let rng = PRNG.hashSeed('MONTE-CARLO-VERIFY');

  for (const c of cases) {
    let wins = 0;
    let totalAttSurv = 0;
    for (let t = 0; t < TRIALS; t++) {
      const res = Combat.resolveCombat(rng, c.a, c.d, c.cap);
      rng = res.rng;
      if (res.attackerWon) wins++;
      totalAttSurv += res.attSurvivors;
    }
    const empiricalProb = wins / TRIALS;
    const exactProb = Combat.getWinProbability(c.a, c.d, c.cap);
    const empiricalSurv = totalAttSurv / TRIALS;
    const exactSurv = Combat.getExpectedAttackerSurvivors(c.a, c.d, c.cap);

    // 50,000 trials -> std error <= 0.0022, allow 0.01 margin (4.5 sigma)
    assert.ok(
      Math.abs(empiricalProb - exactProb) < 0.01,
      `(${c.a}v${c.d} cap=${c.cap}): empirical ${empiricalProb.toFixed(4)} vs exact ${exactProb.toFixed(4)}`
    );
    assert.ok(
      Math.abs(empiricalSurv - exactSurv) < 0.04,
      `(${c.a}v${c.d} cap=${c.cap}) surv: empirical ${empiricalSurv.toFixed(4)} vs exact ${exactSurv.toFixed(4)}`
    );
  }
});

// 3. Reinforcements & 12-unit cap
test('Pojačanja: formula 2 + floor(polja / 3), granica 12 jedinica i sprječavanje blokade pri punom kapacitetu', () => {
  assert.equal(GameRules.calculateReinforcements(1), 2);
  assert.equal(GameRules.calculateReinforcements(2), 2);
  assert.equal(GameRules.calculateReinforcements(3), 3);
  assert.equal(GameRules.calculateReinforcements(5), 3);
  assert.equal(GameRules.calculateReinforcements(6), 4);
  assert.equal(GameRules.calculateReinforcements(9), 5);
  assert.equal(GameRules.calculateReinforcements(14), 6);

  let st = GameRules.createGame({ seed: 'REINF-CAP-TEST' });
  const capId = st.capitals[1];
  assert.equal(st.reinforcementsLeft, 2);

  // Cannot end turn before placing reinforcements
  assert.equal(GameRules.endTurn(st).ok, false);

  // Place reinforcements on capital -> transitions to ACTION phase
  st = GameRules.placeReinforcement(st, capId, 1).state;
  assert.equal(st.phase, CONFIG.PHASES.REINFORCE);
  assert.equal(st.reinforcementsLeft, 1);
  st = GameRules.placeReinforcement(st, capId, 1).state;
  assert.equal(st.phase, CONFIG.PHASES.ACTION);
  assert.equal(st.reinforcementsLeft, 0);
  assert.equal(st.tiles[capId].units, 7);

  // Test cap at 12: craft a state where only owned tile has 11 units and 2 reinforcements left
  const cappedTiles = st.tiles.map((t) => ({ ...t }));
  cappedTiles[capId].units = 11;
  const cappedState = {
    ...st,
    tiles: cappedTiles,
    phase: CONFIG.PHASES.REINFORCE,
    reinforcementsLeft: 2,
  };
  const r = GameRules.placeReinforcement(cappedState, capId, 1);
  assert.equal(r.ok, true);
  assert.equal(r.state.tiles[capId].units, 12);
  assert.equal(r.forfeited, 1);
  assert.equal(r.state.reinforcementsLeft, 0);
  assert.equal(r.state.phase, CONFIG.PHASES.ACTION);
});

// 4. Movement, Merge, Conquest & Locking Rules
test('Ograničenja kretanja: barem 1 ostaje, bez vode, granica 12 pri spajanju, zaključavanje nakon primanja', () => {
  let st = GameRules.createGame({ seed: 'MOVE-RULES-TEST' });
  const capId = st.capitals[1];
  st = GameRules.placeReinforcement(st, capId, 2).state; // 7 units on capital

  const landNbrs = HexGrid.TOPOLOGY.neighbors[capId].filter((id) => !st.tiles[id].isWater);
  assert.ok(landNbrs.length >= 4);
  const n1 = landNbrs[0];
  const n2 = landNbrs[1];

  // Cannot send all 7 units (must leave at least 1)
  assert.equal(GameRules.executeMove(st, capId, n1, 7).ok, false);
  // Cannot send 0 units
  assert.equal(GameRules.executeMove(st, capId, n1, 0).ok, false);
  // Cannot move to water tile
  const waterTile = st.tiles.find((t) => t.isWater);
  assert.equal(GameRules.executeMove(st, capId, waterTile.id, 2).ok, false);
  // Cannot move to non-adjacent tile
  assert.equal(GameRules.executeMove(st, capId, st.capitals[2], 2).ok, false);

  // Create controlled friendly neighbor to test merge & cap & lock
  const modTiles = st.tiles.map((t) => ({ ...t }));
  modTiles[capId].units = 8;
  modTiles[n1].owner = CONFIG.PLAYERS.HUMAN;
  modTiles[n1].units = 10;
  modTiles[n2].owner = CONFIG.PLAYERS.NEUTRAL;
  modTiles[n2].units = 1;
  let modState = { ...st, tiles: modTiles };

  // Max sendable to n1 (10 units) is 2 because cap is 12!
  assert.equal(GameRules.getMaxSendable(modState, capId, n1), 2);
  assert.equal(GameRules.executeMove(modState, capId, n1, 3).ok, false);

  // Merge 2 units into n1 -> n1 becomes 12 and is LOCKED (receivedThisTurn = true)
  const merged = GameRules.executeMove(modState, capId, n1, 2);
  assert.equal(merged.ok, true);
  assert.equal(merged.moveType, 'merge');
  assert.equal(merged.state.tiles[capId].units, 6);
  assert.equal(merged.state.tiles[n1].units, 12);
  assert.equal(merged.state.tiles[n1].receivedThisTurn, true);
  assert.equal(GameRules.canTileAct(merged.state, n1), false);

  // Source tile capId still has 6 units and did NOT receive units, so it can still attack n2
  assert.equal(GameRules.canTileAct(merged.state, capId), true);

  // Test conquest locking (use 5 units vs 1 neutral; keep retrying deterministic seeds if unlucky)
  const atkRes = GameRules.executeMove(merged.state, capId, n2, 5);
  assert.equal(atkRes.ok, true);
  if (atkRes.combat.attackerWon) {
    assert.equal(atkRes.state.tiles[n2].owner, CONFIG.PLAYERS.HUMAN);
    assert.equal(atkRes.state.tiles[n2].receivedThisTurn, true);
    assert.equal(GameRules.canTileAct(atkRes.state, n2), false);
  }

  // Next turn resets receivedThisTurn
  let afterHuman = GameRules.endTurn(merged.state).state;
  assert.equal(afterHuman.tiles[n1].receivedThisTurn, false);
});

// 5. Victory Conditions
test('Uvjeti pobjede: osvajanje prijestolnice, eliminacija svih polja i pravilo 40 punih krugova', () => {
  // 5a. Capital capture ends game immediately even when enemy owns other tiles
  let st = GameRules.createGame({ seed: 'VICTORY-CAP' });
  const aiCap = st.capitals[2];
  const aiNbrs = HexGrid.TOPOLOGY.neighbors[aiCap].filter((id) => !st.tiles[id].isWater);
  const tiles = st.tiles.map((t) => ({ ...t }));
  tiles[aiNbrs[0]].owner = CONFIG.PLAYERS.HUMAN;
  tiles[aiNbrs[0]].units = 12;
  tiles[aiNbrs[1]].owner = CONFIG.PLAYERS.AI; // AI still has another tile
  tiles[aiNbrs[1]].units = 5;
  tiles[aiCap].units = 1; // weakened AI capital so 11 units virtually always capture it
  let sCap = { ...st, tiles, phase: CONFIG.PHASES.ACTION, reinforcementsLeft: 0 };

  // Find a deterministic RNG state where 11 vs 1 capital wins
  let capResult = GameRules.executeMove(sCap, aiNbrs[0], aiCap, 11);
  assert.equal(capResult.ok, true);
  assert.equal(capResult.combat.attackerWon, true);
  assert.equal(capResult.state.phase, CONFIG.PHASES.GAME_OVER);
  assert.equal(capResult.state.winner, CONFIG.PLAYERS.HUMAN);
  assert.equal(capResult.state.winReason, 'capital');

  // 5b. 40-round tie-break by tiles
  const tTiles = st.tiles.map((t) => ({ ...t }));
  const hNbr = HexGrid.TOPOLOGY.neighbors[st.capitals[1]].find((id) => !tTiles[id].isWater);
  tTiles[hNbr].owner = CONFIG.PLAYERS.HUMAN;
  tTiles[hNbr].units = 2; // Human has 2 tiles, AI has 1 tile
  const r40TilesState = {
    ...st,
    tiles: tTiles,
    firstPlayer: CONFIG.PLAYERS.HUMAN,
    currentPlayer: CONFIG.PLAYERS.AI, // second player finishing round 40
    round: CONFIG.MAX_ROUNDS,
    phase: CONFIG.PHASES.ACTION,
    reinforcementsLeft: 0,
  };
  const endedTiles = GameRules.endTurn(r40TilesState).state;
  assert.equal(endedTiles.phase, CONFIG.PHASES.GAME_OVER);
  assert.equal(endedTiles.winner, CONFIG.PLAYERS.HUMAN);
  assert.equal(endedTiles.winReason, 'rounds_tiles');

  // 5c. 40-round tie-break by total units when tiles are equal
  const uTiles = st.tiles.map((t) => ({ ...t }));
  uTiles[st.capitals[1]].units = 5;
  uTiles[st.capitals[2]].units = 9; // Both have 1 tile, AI has more units
  const r40UnitsState = {
    ...st,
    tiles: uTiles,
    firstPlayer: CONFIG.PLAYERS.HUMAN,
    currentPlayer: CONFIG.PLAYERS.AI,
    round: CONFIG.MAX_ROUNDS,
    phase: CONFIG.PHASES.ACTION,
    reinforcementsLeft: 0,
  };
  const endedUnits = GameRules.endTurn(r40UnitsState).state;
  assert.equal(endedUnits.phase, CONFIG.PHASES.GAME_OVER);
  assert.equal(endedUnits.winner, CONFIG.PLAYERS.AI);
  assert.equal(endedUnits.winReason, 'rounds_units');

  // 5d. Exact draw at 40 rounds when both tiles and units are tied
  const dTiles = st.tiles.map((t) => ({ ...t }));
  dTiles[st.capitals[1]].units = 5;
  dTiles[st.capitals[2]].units = 5;
  const r40DrawState = {
    ...st,
    tiles: dTiles,
    firstPlayer: CONFIG.PLAYERS.HUMAN,
    currentPlayer: CONFIG.PLAYERS.AI,
    round: CONFIG.MAX_ROUNDS,
    phase: CONFIG.PHASES.ACTION,
    reinforcementsLeft: 0,
  };
  const endedDraw = GameRules.endTurn(r40DrawState).state;
  assert.equal(endedDraw.phase, CONFIG.PHASES.GAME_OVER);
  assert.equal(endedDraw.winner, 'draw');
  assert.equal(endedDraw.winReason, 'rounds_draw');
});

// 6. Croatian pluralization grammar
test('Hrvatska pluralizacija (1 jedinica, 2 jedinice, 5 jedinica, 11-14, 21, 22, polja, krugovi)', () => {
  assert.equal(Locale.formatUnits(0), '0 jedinica');
  assert.equal(Locale.formatUnits(1), '1 jedinica');
  assert.equal(Locale.formatUnits(2), '2 jedinice');
  assert.equal(Locale.formatUnits(3), '3 jedinice');
  assert.equal(Locale.formatUnits(4), '4 jedinice');
  assert.equal(Locale.formatUnits(5), '5 jedinica');
  assert.equal(Locale.formatUnits(11), '11 jedinica');
  assert.equal(Locale.formatUnits(12), '12 jedinica');
  assert.equal(Locale.formatUnits(14), '14 jedinica');
  assert.equal(Locale.formatUnits(21), '21 jedinica');
  assert.equal(Locale.formatUnits(22), '22 jedinice');
  assert.equal(Locale.formatUnits(25), '25 jedinica');
  assert.equal(Locale.formatUnits(101), '101 jedinica');
  assert.equal(Locale.formatUnits(111), '111 jedinica');

  assert.equal(Locale.formatTiles(1), '1 polje');
  assert.equal(Locale.formatTiles(2), '2 polja');
  assert.equal(Locale.formatTiles(5), '5 polja');
  assert.equal(Locale.formatTiles(21), '21 polje');

  assert.equal(Locale.formatRounds(1), '1 krug');
  assert.equal(Locale.formatRounds(3), '3 kruga');
  assert.equal(Locale.formatRounds(5), '5 krugova');
  assert.equal(Locale.formatRounds(40), '40 krugova');
});

// 7. 2-Player Local Mode (PvP)
test('Način za 2 igrača (PvP): oba igrača su ljudski upravljani i uredno izmjenjuju poteze', () => {
  let st = GameRules.createGame({ seed: 'PVP-TEST-1', mode: CONFIG.MODES.PVP });
  assert.equal(st.mode, CONFIG.MODES.PVP);
  assert.equal(st.currentPlayer, CONFIG.PLAYERS.HUMAN);
  assert.equal(GameRules.isHumanControlled(st, CONFIG.PLAYERS.HUMAN), true);
  assert.equal(GameRules.isHumanControlled(st, CONFIG.PLAYERS.AI), true);

  // Player 1 reinforces & ends turn -> switches to Player 2 (still Round 1)
  st = GameRules.placeReinforcement(st, st.capitals[1], 2).state;
  assert.equal(st.phase, CONFIG.PHASES.ACTION);
  st = GameRules.endTurn(st).state;
  assert.equal(st.currentPlayer, CONFIG.PLAYERS.AI);
  assert.equal(st.round, 1);
  assert.equal(st.phase, CONFIG.PHASES.REINFORCE);
  assert.equal(st.reinforcementsLeft, 2);
  assert.equal(GameRules.isHumanControlled(st), true);

  // Player 2 reinforces & attacks adjacent neutral, then ends turn -> Round 2, Player 1
  st = GameRules.placeReinforcement(st, st.capitals[2], 2).state;
  assert.equal(st.tiles[st.capitals[2]].units, 7);
  const p2Targets = GameRules.getValidTargets(st, st.capitals[2]);
  assert.ok(p2Targets.length > 0);
  const moveRes = GameRules.executeMove(st, st.capitals[2], p2Targets[0].tileId, 6);
  assert.equal(moveRes.ok, true);
  st = GameRules.endTurn(moveRes.state).state;
  assert.equal(st.currentPlayer, CONFIG.PLAYERS.HUMAN);
  assert.equal(st.round, 2);
});

// 8. Adventure Ruleset: Landmarks, Powers, Perks, Exact Lucky Die Probability & Headless AI stability
test('Avantura: posebna polja (2 kovačnice, 2 kule, 3 škrinje), determinizam i prihod kovačnice', () => {
  const g1 = GameRules.createGame({ seed: 'AVANTURA-123', ruleset: CONFIG.RULESETS.ADVENTURE });
  const g2 = GameRules.createGame({ seed: 'AVANTURA-123', ruleset: CONFIG.RULESETS.ADVENTURE });
  assert.deepEqual(g1.tiles, g2.tiles);
  assert.equal(g1.energy[1], CONFIG.ADVENTURE.START_ENERGY);

  const forges = g1.tiles.filter((t) => t.landmark === 'forge');
  const towers = g1.tiles.filter((t) => t.landmark === 'tower');
  const chests = g1.tiles.filter((t) => t.landmark === 'chest');
  assert.equal(forges.length, 2);
  assert.equal(towers.length, 2);
  assert.equal(chests.length, 3);

  // Owning a forge grants +1 extra reinforcement per turn
  const modTiles = g1.tiles.map((t) => ({ ...t }));
  modTiles[forges[0].id].owner = CONFIG.PLAYERS.HUMAN;
  modTiles[forges[0].id].units = 2;
  const modState = { ...g1, tiles: modTiles };
  // 2 owned tiles => base 2 + floor(2/3)=0 + 1 forge = 3
  assert.equal(GameRules.calculatePlayerReinforcements(modState, CONFIG.PLAYERS.HUMAN), 3);

  // Owning a tower grants defense bonus (+1)
  modTiles[towers[0].id].owner = CONFIG.PLAYERS.HUMAN;
  assert.equal(GameRules.hasDefenseBonus(modTiles[towers[0].id]), true);
});

test('Avantura: moći (Štit, Munja, Juriš), nadogradnje (Perks) i egzaktna vjerojatnost Sretne kocke', () => {
  // Exact Lucky Die (+1 round 1 attacker) probability verified against 60,000 Monte Carlo combats
  const TRIALS = 60000;
  let rng = PRNG.hashSeed('LUCKY-DIE-MC');
  let wins = 0;
  for (let i = 0; i < TRIALS; i++) {
    const res = Combat.resolveCombat(rng, 4, 3, true, 1);
    rng = res.rng;
    if (res.attackerWon) wins++;
  }
  const emp = wins / TRIALS;
  const exact = Combat.getWinProbability(4, 3, true, 1);
  assert.ok(Math.abs(emp - exact) < 0.01, `Lucky die (4v3 cap): emp ${emp.toFixed(4)} vs exact ${exact.toFixed(4)}`);

  // Powers: Bolt, Shield, Rush
  let st = GameRules.createGame({ seed: 'POWERS-TEST', ruleset: CONFIG.RULESETS.ADVENTURE });
  const capId = st.capitals[1];
  const landNbrs = HexGrid.TOPOLOGY.neighbors[capId].filter((id) => !st.tiles[id].isWater);
  const tiles = st.tiles.map((t) => ({ ...t }));
  tiles[landNbrs[0]].owner = CONFIG.PLAYERS.HUMAN;
  tiles[landNbrs[0]].units = 5;
  tiles[landNbrs[0]].receivedThisTurn = true;
  tiles[landNbrs[1]].owner = CONFIG.PLAYERS.NEUTRAL;
  tiles[landNbrs[1]].units = 3;
  let s = {
    ...st,
    tiles,
    phase: CONFIG.PHASES.ACTION,
    reinforcementsLeft: 0,
    energy: { 1: 6, 2: 1 },
  };

  // Shield on landNbrs[0] (costs 2)
  const sh = GameRules.usePower(s, 'shield', landNbrs[0]);
  assert.equal(sh.ok, true);
  assert.equal(sh.state.tiles[landNbrs[0]].shielded, true);
  assert.equal(GameRules.hasDefenseBonus(sh.state.tiles[landNbrs[0]]), true);
  assert.equal(sh.state.energy[1], 4);

  // Bolt on landNbrs[1] (costs 3, removes 2 from 3 -> leaves 1)
  const bl = GameRules.usePower(sh.state, 'bolt', landNbrs[1]);
  assert.equal(bl.ok, true);
  assert.equal(bl.damageDealt, 2);
  assert.equal(bl.state.tiles[landNbrs[1]].units, 1);
  assert.equal(bl.state.energy[1], 1);

  // Rush on locked landNbrs[0] (needs 4 energy)
  const rushState = { ...bl.state, energy: { 1: 4, 2: 1 } };
  const ru = GameRules.usePower(rushState, 'rush', landNbrs[0]);
  assert.equal(ru.ok, true);
  assert.equal(ru.state.tiles[landNbrs[0]].receivedThisTurn, false);
  assert.equal(ru.state.energy[1], 0);

  // Perk choice: royal_vault immediately adds +3 units & +3 energy
  const perkPending = {
    ...ru.state,
    pendingPerkChoice: { player: 1, options: ['royal_vault', 'lucky_die', 'shockwave'] },
  };
  const ch = GameRules.choosePerk(perkPending, 'royal_vault');
  assert.equal(ch.ok, true);
  assert.equal(ch.state.pendingPerkChoice, null);
  assert.equal(ch.state.energy[1], 3);
  assert.equal(ch.state.tiles[capId].units, 8);
  assert.equal(GameRules.hasPerk(ch.state, 1, 'royal_vault'), true);
});

test('Avantura: 60 AI vs AI partija bez sučelja (0 rušenja, 0 zaglavljivanja, ispravno korištenje moći i nadogradnji)', () => {
  const { AI } = loadEngine();
  let totalPowers = 0;
  let totalChests = 0;
  for (let i = 0; i < 60; i++) {
    let st = GameRules.createGame({
      seed: `ADV-AI-${i + 1}`,
      ruleset: CONFIG.RULESETS.ADVENTURE,
      difficulty: 'hard',
      firstPlayer: i % 2 === 0 ? 1 : 2,
    });
    let turns = 0;
    while (st.phase !== CONFIG.PHASES.GAME_OVER) {
      assert.ok(turns++ < 84, `Adventure AI hung on seed ADV-AI-${i + 1}`);
      const d = st.currentPlayer === 1 ? 'hard' : (i % 2 === 0 ? 'normal' : 'easy');
      st = AI.playFullTurn(st, d);
    }
    assert.ok(st.round <= CONFIG.MAX_ROUNDS);
    totalPowers += st.stats[1].powersUsed + st.stats[2].powersUsed;
    totalChests += st.stats[1].chestsOpened + st.stats[2].chestsOpened;
  }
  assert.ok(totalPowers > 20, `Expected AI to use powers in Adventure mode (got ${totalPowers})`);
  assert.ok(totalChests > 20, `Expected AI to open chests in Adventure mode (got ${totalChests})`);
});

test('Avantura: Otočni događaji svaka 4 kruga (determinizam, učinci, bez aktivacije u Klasici)', () => {
  // 1. Classic mode NEVER triggers island events at round 4
  let classic = GameRules.createGame({ seed: 'CLASSIC-EV-CHECK', ruleset: CONFIG.RULESETS.CLASSIC });
  for (let t = 0; t < 6; t++) {
    const cap = classic.capitals[classic.currentPlayer];
    if (classic.phase === CONFIG.PHASES.REINFORCE) {
      classic = GameRules.placeReinforcement(classic, cap, classic.reinforcementsLeft).state;
    }
    const ended = GameRules.endTurn(classic);
    assert.equal(ended.triggeredEvent, null);
    classic = ended.state;
  }
  assert.equal(classic.round, 4);
  assert.equal(classic.activeEvent, null);

  // 2. Adventure mode triggers deterministic symmetric events at round 4 across seeds, hitting all 4 event types
  const seenTypes = new Set();
  for (let s = 0; s < 40; s++) {
    let adv1 = GameRules.createGame({ seed: `EVENT-SEED-${s}`, ruleset: CONFIG.RULESETS.ADVENTURE });
    let adv2 = GameRules.createGame({ seed: `EVENT-SEED-${s}`, ruleset: CONFIG.RULESETS.ADVENTURE });
    let ev1 = null;
    let ev2 = null;

    // Advance 3 full rounds (6 turns) to reach start of Round 4
    for (let t = 0; t < 6; t++) {
      const cap1 = adv1.capitals[adv1.currentPlayer];
      if (adv1.phase === CONFIG.PHASES.REINFORCE) {
        adv1 = GameRules.placeReinforcement(adv1, cap1, adv1.reinforcementsLeft).state;
        adv2 = GameRules.placeReinforcement(adv2, cap1, adv2.reinforcementsLeft).state;
      }
      const r1 = GameRules.endTurn(adv1);
      const r2 = GameRules.endTurn(adv2);
      if (t < 5) {
        assert.equal(r1.triggeredEvent, null, 'Event should not trigger before round 4');
      } else {
        ev1 = r1.triggeredEvent;
        ev2 = r2.triggeredEvent;
      }
      adv1 = r1.state;
      adv2 = r2.state;
    }

    assert.equal(adv1.round, 4);
    assert.ok(ev1 && ev1.id, `Expected island event on round 4 for EVENT-SEED-${s}`);
    assert.deepEqual(ev1, ev2, 'Island event must be deterministic for the same seed');
    seenTypes.add(ev1.id);

    // Verify specific effects of each event type
    if (ev1.id === 'gold_rain') {
      assert.equal(ev1.chestsSpawned.length, 2);
      for (const tid of ev1.chestsSpawned) {
        assert.equal(adv1.tiles[tid].landmark, 'chest');
      }
    } else if (ev1.id === 'energy_storm') {
      // Started at 1 energy, no conquests -> both sides must now be at 3
      assert.equal(adv1.energy[1], 3);
      assert.equal(adv1.energy[2], 3);
    } else if (ev1.id === 'fair_wind') {
      // Base 2 + 1 fair_wind = 3 reinforcements for P1 (capped by free capacity)
      assert.equal(GameRules.calculatePlayerReinforcements(adv1, 1), 3);
      assert.equal(GameRules.calculatePlayerReinforcements(adv1, 2), 3);
    } else if (ev1.id === 'lucky_tide') {
      assert.equal(adv1.luckyTideReady[1], true);
      assert.equal(adv1.luckyTideReady[2], true);
      assert.equal(GameRules.getAttackFirstRoundBonus(adv1, 1), 1);

      // Stacks with lucky_die perk (+2 total!)
      const withPerk = { ...adv1, perks: { 1: ['lucky_die'], 2: [] } };
      assert.equal(GameRules.getAttackFirstRoundBonus(withPerk, 1), 2);

      // Consumes luckyTideReady[1] after P1's first attack
      let stAtk = adv1;
      if (stAtk.phase === CONFIG.PHASES.REINFORCE) {
        stAtk = GameRules.placeReinforcement(stAtk, stAtk.capitals[1], stAtk.reinforcementsLeft).state;
      }
      const tgs = GameRules.getValidTargets(stAtk, stAtk.capitals[1]);
      const atkRes = GameRules.executeMove(stAtk, stAtk.capitals[1], tgs[0].tileId, 2);
      assert.equal(atkRes.ok, true);
      assert.equal(atkRes.attFirstRoundBonus, 1);
      assert.equal(atkRes.state.luckyTideReady[1], false);
      assert.equal(atkRes.state.luckyTideReady[2], true);
    }
  }
  assert.equal(seenTypes.size, 4, `Expected all 4 island event types to occur across 40 seeds, saw: ${[...seenTypes].join(', ')}`);
});

console.log(`\nRezultat testova: ${passed} prošlo, ${failed} palo.\n`);
if (failed > 0) process.exit(1);
