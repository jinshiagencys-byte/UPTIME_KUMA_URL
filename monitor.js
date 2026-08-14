const { chromium } = require('playwright');

(async () => {
  // Récupération de l'URL Push transmise par le secret GitHub Actions
  const UPTIME_KUMA_URL = process.env.UPTIME_KUMA_URL;

  if (!UPTIME_KUMA_URL) {
    console.error("❌ ERREUR : La variable UPTIME_KUMA_URL n'est pas définie.");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log("🚀 Lancement du test Playwright...");

    // 1. Mets ici l'URL de la page ou du site que tu veux tester
    await page.goto('https://adorable-bonbon-d2a467.netlify.app/', { waitUntil: 'networkidle' });

    // 2. Exemple de vérification (ex: présence d'un titre ou bouton)
    await page.waitForSelector('h1', { timeout: 10000 });

    console.log("✅ Scénario réussi ! Envoi du ping à Uptime Kuma...");

    // 3. Envoi du ping avec le header anti-avertissement LocalTunnel
    const response = await fetch(UPTIME_KUMA_URL, {
      method: 'GET',
      headers: {
        'Bypass-Tunnel-Reminder': 'true'
      }
    });

    console.log(`📡 Réponse d'Uptime Kuma (Status Code) : ${response.status}`);

  } catch (error) {
    console.error("❌ ÉCHEC du scénario Playwright :", error.message);
    // Si le test échoue, on fait sortir le script avec un code d'erreur (exit 1).
    // On NE PING PAS Kuma -> Kuma passera au rouge !
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
