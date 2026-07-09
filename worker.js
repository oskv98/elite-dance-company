// ================================================
// Worker independiente que dispara los chequeos automáticos:
//  1) Vencimientos de mensualidades: una vez al día, 8:00 a.m. Venezuela.
//  2) Recordatorios de clase (30 min y 5 min antes): cada 5 minutos.
// Cloudflare Pages Functions no soportan Cron Triggers directamente, así
// que este Worker chiquito llama a los endpoints de Pages por HTTP.
//
// Se despliega aparte con: npx wrangler deploy
// (usando el wrangler.toml de esta misma carpeta)
// ================================================

const DOMINIO = 'https://elite-dance-company.pages.dev';

export default {
    async scheduled(event, env, ctx) {
        // event.cron nos dice cuál de las dos expresiones de wrangler.toml disparó esto
        const esDiario = event.cron === '0 12 * * *';

        const endpoint = esDiario ? 'check-vencimientos' : 'check-horarios';
        const url = `${DOMINIO}/${endpoint}?secret=${env.CRON_SECRET}`;
        ctx.waitUntil(
            fetch(url).then(r => r.text()).then(txt => console.log(`${endpoint}:`, txt))
        );
    },
};