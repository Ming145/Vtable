import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';

export default [
        { ignores: ['node_modules/**', 'main.js'] },
        ...tseslint.configs.recommended,
        ...obsidianmd.configs.recommended,
        {
                files: ['src/**/*.ts'],
                languageOptions: {
                        parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
                },
        },
];
