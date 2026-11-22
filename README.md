# Otok Kapetana — Heksagon Avantura

Potezna heksagonalna igra osvajanja otočja za preglednik, napisana u jednoj samostalnoj datoteci ([index.html](index.html)) bez vanjskih biblioteka, fontova, slika ili mrežnih zahtjeva.

## Pokretanje

Otvori [index.html](index.html) izravno s diska u Chromeu, Firefoxu ili Safariju (radi preko `file://`, bez poslužitelja i bez koraka gradnje) ili na webu putem GitHub Pages (`https://shutzer.github.io/otok-kapetana/`).

## Načini igre

- **⚡ Avantura** *(zadano)* — Kapetan Val protiv Baruna Žara: posebna polja na mapi (⚒️ Kovačnice, 🗼 Kule stražare, 💎 Škrinje s blagom), kristali energije i taktičke moći (🛡️ Štit, ⚡ Munja, 🔥 Dvostruki juriš), trajne nadogradnje tijekom partije, medalje i iznenadni Otočni događaji svaka 4 kruga.
- **🏛️ Klasika** — čista izvorna pravila na 91 heksagonalnom polju bez dodataka.
- **1 igrač (Solo)** protiv tri razine računalnog protivnika (*Gusarčić / Lagano*, *Kapetan / Normalno*, *Šef Žar! / Teško*) ili **2 igrača** na istom uređaju.

## Provjera i testovi (Node.js ≥ 22)

Jezgra igre (`CONFIG`, `Locale`, `PRNG`, `HexGrid`, `Combat`, `MapGenerator`, `GameRules`, `AI`) potpuno je odvojena od preglednika i DOM-a te se testira izravno u Nodeu:

```sh
npm test                      # jedinični testovi pravila, vjerojatnosti, PvP-a, Avanture i događaja
npm run benchmark             # 600 AI vs AI partija u Klasici (prag: >= 65% za jaču razinu)
npm run benchmark:adventure   # 600 AI vs AI partija u Avanturi (moći, škrinje, nadogradnje, događaji)
npm run verify                # svi testovi + AI benchmark
```

## Struktura

- [index.html](index.html) — cijela igra (CSS, SVG likovi, Canvas 2.5D diorama, Web Audio sintisajzer i čista logika igre).
- [tests/load-engine.mjs](tests/load-engine.mjs) — izolirani učitavač jezgre bez DOM-a uz provjeru 0 globalnih varijabli.
- [tests/rules.test.mjs](tests/rules.test.mjs) — jedinični testovi pravila, borbene matematike i determinizma.
- [tests/ai-benchmark.mjs](tests/ai-benchmark.mjs) — automatski turnir 600 partija između tri razine AI-ja (Klasika i `--adventure`).
- [LICENSE](LICENSE) — MIT licenca.
