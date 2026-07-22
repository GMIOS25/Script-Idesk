import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

async function build() {
    const metaContent = fs.readFileSync(path.join(process.cwd(), 'src', 'meta.js'), 'utf-8');

    const result = await esbuild.build({
        entryPoints: ['src/index.js'],
        bundle: true,
        write: false,
        format: 'iife',
        minify: false,
        target: 'es2020'
    });

    const code = result.outputFiles[0].text;
    const finalScript = metaContent.trim() + '\n\n' + code;

    const targetPath = path.join(process.cwd(), 'src', 'idesk_automation.user.js');
    fs.writeFileSync(targetPath, finalScript, 'utf-8');

    // Also output to dist/
    const distDir = path.join(process.cwd(), 'dist');
    if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
    }
    fs.writeFileSync(path.join(distDir, 'idesk_automation.user.js'), finalScript, 'utf-8');

    console.log(' Successfully built idesk_automation.user.js');
}

build().catch(err => {
    console.error(' Build failed:', err);
    process.exit(1);
});
