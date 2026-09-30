import asyncio
import os
import json
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig
from openai import OpenAI

async def run_pipeline():
    print("1. Début de l'extraction de odjafrik.com...")
    
    browser_cfg = BrowserConfig(
        headless=True,
        extra_args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
    )
    
    run_cfg = CrawlerRunConfig(
        word_count_threshold=5,
        exclude_external_links=True
    )

    async with AsyncWebCrawler(config=browser_cfg) as crawler:
        result = await crawler.arun(
            url="https://odjafrik.com",
            config=run_cfg
        )
        
        if not result.success:
            print(f"Erreur d'extraction : {result.error_message}")
            return
            
        print("Extraction réussie ! Sauvegarde du Markdown...")
        markdown_content = result.markdown
        with open("odjafrik_structure.md", "w", encoding="utf-8") as f:
            f.write(markdown_content)

    # 2. Connexion à OpenRouter (Gratuit)
    print("2. Envoi des données à OpenRouter (Modèle gratuit)...")
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("Erreur : La variable d'environnement OPENROUTER_API_KEY est manquante.")
        return

    # Configuration du client OpenAI pour pointer vers OpenRouter
    client = OpenAI(
        base_url="https://openrouter.ai",
        api_key=api_key,
        default_headers={
            "HTTP-Referer": "https://github.com", # Recommandé par OpenRouter
            "X-Title": "Sitemap Testing Generator"
        }
    )
    
    prompt = (
        "Agis en tant qu'ingénieur QA senior. Voici le contenu brut au format Markdown d'un site web obtenu par crawling.\n\n"
        f"--- DEBUT DU CONTENU ---\n{markdown_content[:6000]}\n--- FIN DU CONTENU ---\n\n"
        "Génère un sitemap complet au format JSON structuré spécifiquement optimisé pour le testing fonctionnel.\n"
        "Le JSON doit impérativement suivre cette structure exacte :\n"
        "{\n"
        "  \"site\": \"odjafrik.com\",\n"
        "  \"pages_to_test\": [\n"
        "    {\n"
        "      \"url\": \"/\",\n"
        "      \"page_purpose\": \"Objectif de la page\",\n"
        "      \"critical_elements_to_verify\": [\"Élément 1\", \"Élément 2\"],\n"
        "      \"suggested_test_scenarios\": [\"Scénario de test A\", \"Scénario de test B\"]\n"
        "    }\n"
        "  ]\n"
        "}\n"
        "Renvoie UNIQUEMENT le code JSON valide, sans blocs de code markdown (pas de ```json), sans explications autour."
    )

    try:
        response = client.chat.completions.create(
            model="openrouter/free", # Utilise automatiquement le meilleur modèle gratuit dispo
            messages=[
                {"role": "system", "content": "Tu es un expert QA technique qui génère exclusivement du JSON valide."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2
        )
        
        raw_json = response.choices.message.content.strip()
        
        # Validation et sauvegarde du JSON
        sitemap_json = json.loads(raw_json)
        with open("odjafrik_testing_sitemap.json", "w", encoding="utf-8") as f:
            json.dump(sitemap_json, f, indent=2, ensure_ascii=False)
            
        print("Fichier odjafrik_testing_sitemap.json généré avec succès par l'IA !")

    except Exception as e:
        print(f"Erreur lors de la génération IA : {e}")

if __name__ == "__main__":
    asyncio.run(run_pipeline())
