import assert from 'node:assert/strict';
import { loadEngine } from './load-engine.mjs';

const { CONFIG, GameRules, AI } = loadEngine();

const GAMES_PER_PAIR = 200; // 3 pairs * 200 = 600 games total (> 500 required)

function simulateMatch(seed, diffA, diffB, firstPlayer) {
  let state = GameRules.createGame({
    seed,
    difficulty: diffA,
    firstPlayer,
  });

  const maxHalfTurns = CONFIG.MAX_ROUNDS * 2 + 4;
  let halfTurns = 0;

  while (state.phase !== CONFIG.PHASES.GAME_OVER) {
    assert.ok(halfTurns < maxHalfTurns, `Game hung on seed ${seed} (${diffA} vs ${diffB}) at turn ${halfTurns}`);
    assert.ok(state.round <= CONFIG.MAX_ROUNDS, `Exceeded max rounds (${state.round}) on seed ${seed}`);

    const activeDiff = state.currentPlayer === CONFIG.PLAYERS.HUMAN ? diffA : diffB;
    const prevTurn = state.turnNumber;
    const prevPlayer = state.currentPlayer;

    state = AI.playFullTurn(state, activeDiff);

    if (state.phase !== CONFIG.PHASES.GAME_OVER) {
      assert.ok(
        state.turnNumber > prevTurn || state.currentPlayer !== prevPlayer,
        `Turn did not advance on seed ${seed} (${activeDiff})`
      );
    }
    halfTurns++;
  }

  assert.ok(state.round <= CONFIG.MAX_ROUNDS, `Final round ${state.round} > ${CONFIG.MAX_ROUNDS}`);
  assert.ok(
    state.winner === CONFIG.PLAYERS.HUMAN || state.winner === CONFIG.PLAYERS.AI || state.winner === 'draw',
    `Invalid winner: ${state.winner}`
  );

  return {
    winner: state.winner,
    winReason: state.winReason,
    rounds: state.round,
  };
}

function runPair(strongDiff, weakDiff, count) {
  let strongWins = 0;
  let weakWins = 0;
  let draws = 0;
  let totalRounds = 0;
  const reasons = { capital: 0, elimination: 0, rounds_tiles: 0, rounds_units: 0, rounds_draw: 0 };

  const t0 = performance.now();

  for (let i = 0; i < count; i++) {
    const seed = `BENCH-${strongDiff.toUpperCase()}-VS-${weakDiff.toUpperCase()}-${i + 1}`;
    // Alternate first player AND sides evenly across games
    const firstPlayer = i % 2 === 0 ? CONFIG.PLAYERS.HUMAN : CONFIG.PLAYERS.AI;
    const strongIsHuman = Math.floor(i / 2) % 2 === 0;
    const diff1 = strongIsHuman ? strongDiff : weakDiff;
    const diff2 = strongIsHuman ? weakDiff : strongDiff;

    const res = simulateMatch(seed, diff1, diff2, firstPlayer);
    totalRounds += res.rounds;
    if (res.winReason in reasons) reasons[res.winReason]++;

    if (res.winner === 'draw') {
      draws++;
    } else if (
      (strongIsHuman && res.winner === CONFIG.PLAYERS.HUMAN) ||
      (!strongIsHuman && res.winner === CONFIG.PLAYERS.AI)
    ) {
      strongWins++;
    } else {
      weakWins++;
    }
  }

  const elapsedMs = performance.now() - t0;
  const winRate = (strongWins / count) * 100;
  const decisiveRate = (strongWins / Math.max(1, strongWins + weakWins)) * 100;

  return {
    strongDiff,
    weakDiff,
    count,
    strongWins,
    weakWins,
    draws,
    winRate,
    decisiveRate,
    avgRounds: totalRounds / count,
    elapsedMs,
    reasons,
  };
}

console.log(`\n=== Heksagon: AI vs AI Benchmark (${GAMES_PER_PAIR * 3} partija bez sučelja) ===\n`);

const pairs = [
  ['normal', 'easy'],
  ['hard', 'normal'],
  ['hard', 'easy'],
];

const results = [];
let allPassed = true;

for (const [strong, weak] of pairs) {
  const r = runPair(strong, weak, GAMES_PER_PAIR);
  results.push(r);
  const ok = r.winRate >= 65;
  if (!ok) allPassed = false;
  console.log(
    `${ok ? '✓' : '✗'} ${r.strongDiff.toUpperCase()} vs ${r.weakDiff.toUpperCase()} (${r.count} partija): ` +
    `${r.strongWins}W / ${r.weakWins}L / ${r.draws}D — ` +
    `${r.winRate.toFixed(1)}% pobjeda (odlučene: ${r.decisiveRate.toFixed(1)}%) | ` +
    `prosj. ${r.avgRounds.toFixed(1)} krugova | ${(r.elapsedMs / 1000).toFixed(2)}s | ` +
    `ishodi: kap=${r.reasons.capital}, elim=${r.reasons.elimination}, 40k=${r.reasons.rounds_tiles + r.reasons.rounds_units + r.reasons.rounds_draw}`
  );
}

console.log(`\nUkupno odigrano: ${GAMES_PER_PAIR * 3} partija, 0 rušenja, 0 zaglavljivanja.`);
if (!allPassed) {
  console.error('\nNEUSPJEH: Jedan ili više parova nije dosegnuo prag od 65% pobjeda!');
  process.exit(1);
}
console.log('USPJEH: Svi parovi težina prelaze prag od 65% pobjeda!\n');
