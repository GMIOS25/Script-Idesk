import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

function loadEnv() {
    const envPath = path.join(process.cwd(), '.env.local');
    const envVars = {};
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
                const key = trimmed.slice(0, eqIdx).trim();
                let val = trimmed.slice(eqIdx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                envVars[key] = val;
            }
        }
    }
    return envVars;
}

async function build() {
    const metaContent = fs.readFileSync(path.join(process.cwd(), 'src', 'meta.js'), 'utf-8');
    const envVars = loadEnv();

    const authBaseUrl = process.env.AUTH_BASE_URL || envVars.AUTH_BASE_URL || 'http://localhost:5000';
    const authUsername = process.env.AUTH_USERNAME || envVars.AUTH_USERNAME || 'fe-server-prod';
    const authPassword = process.env.AUTH_PASSWORD || envVars.AUTH_PASSWORD || 'secret_password';

    const result = await esbuild.build({
        entryPoints: ['src/index.js'],
        bundle: true,
        write: false,
        format: 'iife',
        minify: false,
        target: 'es2020',
        define: {
            'process.env.AUTH_BASE_URL': JSON.stringify(authBaseUrl),
            'process.env.AUTH_USERNAME': JSON.stringify(authUsername),
            'process.env.AUTH_PASSWORD': JSON.stringify(authPassword)
        }
    });

    const code = result.outputFiles[0].text;
    const warningBanner = `
// ==============================================================================
// ⚠️ FILE TỰ ĐỘNG SINH RA (AUTO-GENERATED BUNDLE). KHÔNG SỬA TRỰC TIẾP FILE NÀY!
// 💡 Vui lòng sửa code tại các file module trong thư mục src/ (vd: src/config.js,
//    src/services/ai.js, src/ui/dashboard.js...), sau đó gõ "pnpm run build".
// ==============================================================================
`;
    const finalScript = metaContent.trim() + '\n' + warningBanner + '\n' + code;

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
