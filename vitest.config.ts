import { defineConfig } from 'vitest/config';

// Full-run property files drive runFire for hundreds of runs, each held to a 10 s wall-clock limit (Requirement 14.9).
// Running several of them at once on one machine makes the wall clock, not the model, abort a run. They run one file
// at a time in their own project; `npm test` still runs both projects.
const FULL_RUN_FILES = [
  'tests/fire/run.*.test.ts',
  'tests/fire/arbitraries.test.ts',
];

const common = {
  setupFiles: ['tests/fire/setup.ts'],
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'full-run',
          ...common,
          include: FULL_RUN_FILES,
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
      {
        test: {
          name: 'default',
          ...common,
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'validation/**/*.test.ts'],
          exclude: [...FULL_RUN_FILES, '**/node_modules/**'],
        },
      },
    ],
  },
});
