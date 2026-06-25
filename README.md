# Tims Picks
App to help make Tim Hortons Hockey Challenge picks in the Tims app. The Tim Hortons Hockey Challenge is a contest for picking goal scorers in NHL games. The app uses sportsbook implied probability odds to calculate optimal picks.

## About
During the 2025-2026 season, the Tim Hortons Hockey Challenge presented 6 Challenges in addition to the Playoffs.

During the period of Challenges 1 to 3, I would play by making random picks. I am not a knowledgeable hockey fan, and hoped to get some points by pure chance. I ranked better than almost half of the players. Challenge 3 had a poorer result, likely due to missed picks while vacationing.

In early January, by pure luck, 6 consecutive correct picks were made. Being close to win a week's worth of free coffee by making 7 consecutive correct picks, I used goals per game stats to successfully make the 7th pick.

Finding the challenge fun, I continued using goals per game stats, began using sportsbook odds to help make picks, and began developing this app to compile and rank sportsbook odds. Challenges 4 and 5 covered this period, and my winning rate improved to the top 1 in about 20 players.

Challenge 6 and the playoffs are the result of using sportsbook odds to make picks. The Challenge 6 ranked in the top 0.38%, and the Playoffs in the top 1.33%.

## 2025-2026 Season Results
| Challenge   | Period               | Ranking  | Players | Top %  |
| ----------- | -------------------- | -------: | ------: | -----: |
| Challenge 1 | Oct 7 - Oct 31, 2025 | 275010   | 531047  | 51.79% |
| Challenge 2 | Nov 1 - Nov 30, 2025 | 281160   | 533456  | 52.71% |
| Challenge 3 | Dec 1 - Dec 31, 2025 | 297333   | 507403  | 58.60% |
| Challenge 4 | Jan 1 - Jan 31, 2026 | 22665    | 537831  | 4.21%  |
| Challenge 5 | Feb 1 - Feb 28, 2026 | 38955    | 466675  | 8.35%  |
| Challenge 6 | Mar 1 - Apr 16, 2026 | 2314     | 601063  | 0.38%  |
| Playoffs    | Apr 18, 2026         | 7563     | 567347  | 1.33%  |

[Similar to](https://hockeychallengehelper.com/)

[5v5 hockey](https://5v5hockey.com/ai-betting/tims-picks/)

[odds](https://www.rotowire.com/betting/nhl/player-props.php)

[DraftKings](https://sportsbook.draftkings.com/leagues/hockey/nhl?category=goalscorer&subcategory=anytime-goalscorer)
[FanDuel](https://on.sportsbook.fanduel.ca/navigation/nhl?tab=parlay-builder)
[BetMGM](https://www.on.betmgm.ca/en/sports/hockey-12/betting/usa-9/nhl-34)
[BetRivers](https://on.betrivers.ca/?page=sportsbook&group=1000093657&type=playerprops)
[Caesars](https://sportsbook.caesars.com/icehockey?id=b7b715a9-c7e8-4c47-af0a-77385b525e09)
[Hard Rock](https://www.hardrock.bet)
[theScore](https://www.thescore.bet/)

Reacts adaptively to light-dark scheme

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
