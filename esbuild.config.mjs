import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

const ctx = await esbuild.context({
        entryPoints: ["src/main.ts"],
        bundle: true,
        external: [
                "obsidian",
                "electron",
                "@codemirror/autocomplete",
                "@codemirror/collab",
                "@codemirror/commands",
                "@codemirror/language",
                "@codemirror/lint",
                "@codemirror/search",
                "@codemirror/state",
                "@codemirror/view",
                "@lezer/common",
                "@lezer/highlight",
                "@lezer/lr",
                ...builtins,
        ],
        format: "cjs",
        target: "ES2021",
        logLevel: "info",
        sourcemap: prod ? false : "inline",
        treeShaking: true,
        // CSS 以文本内联进 main.js，启动时注入——样式随产物同步分发，用户只替换 main.js 即可
        loader: { ".css": "text" },
        outfile: "main.js",
});

if (prod) {
        await ctx.rebuild();
        process.exit(0);
} else {
        await ctx.watch();
}
