# EVA-UI

NGE UI exploration: recreations of Neon Genesis Evangelion style screens in plain HTML and CSS, with no build step. Studies start CSS only, and vanilla JavaScript is added where a screen needs to be interactive.

Each study has a code (a letter for its screen type plus a number) and lives in a lowercase folder of the same name, for example `W-1` in `w-1/`. Open its `index.html` in a browser to view it.

| Study | Screen |
| --- | --- |
| [W-1](w-1/) | Warning screen: intrusion alert with a sector label and a live seal countdown |
| [C-1](c-1/) | Countdown screen: seven-segment active time display. Enter a time, press START, and it counts down in milliseconds |
| [M-1](m-1/) | MAGI screen: the three supercomputers (Melchior, Balthasar, Casper) and their votes. Submit a motion and each computer processes, then votes; two of three decides. A WebGL backdrop draws a hex field and data lines from the state |
| [T-1](t-1/) | Tactical map: Japan, Kanto and a Hakone close-up with Tokyo-3, drawn as SVG from real coastline and OpenStreetMap data baked by `tools/geo.mjs`. Detect an unknown contact and watch the sites around the city go to alert, the batteries fire, and it is contained or breaches |
