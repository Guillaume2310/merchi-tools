// worker.js — Merchi
// ─────────────────────────────────────────────────────────────
// Sert le site statique (scanner) normalement, et ajoute un point
// d'entrée /api/envoyer-inventaire qui reçoit un export du scanner
// et l'envoie automatiquement par email (via Brevo) à
// fichierpara@merchi-pharma.fr, en pièce jointe.
//
// Nécessite un secret BREVO_API_KEY défini via :
//   npx wrangler secret put BREVO_API_KEY
// (méthode CLI classique — voir historique : l'interface "Secrets Store"
// du dashboard Cloudflare n'a pas fonctionné de manière fiable)

const DESTINATAIRE = "fichierpara@merchi-pharma.fr";
const EXPEDITEUR = "fichierpara@merchi-pharma.fr"; // vérifié + domaine authentifié sur Brevo

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/envoyer-inventaire" && request.method === "POST") {
      return envoyerInventaire(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
};

async function envoyerInventaire(request, env, ctx) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (!env.BREVO_API_KEY) {
    return new Response(JSON.stringify({ error: "BREVO_API_KEY non configurée côté serveur" }), { status: 500, headers: cors });
  }
  const brevoApiKey = env.BREVO_API_KEY;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "JSON invalide" }), { status: 400, headers: cors });
  }

  const { nom_fichier, contenu_base64, officine, date, nb_total } = body || {};
  if (!nom_fichier || !contenu_base64) {
    return new Response(JSON.stringify({ error: "nom_fichier ou contenu_base64 manquant" }), { status: 400, headers: cors });
  }

  // Réponse immédiate au téléphone (pas d'attente du round-trip Brevo,
  // qui prend quelques secondes) — si l'écran s'éteint ou que l'app passe
  // en arrière-plan pendant cette attente, iOS peut couper la connexion
  // et faire croire à un échec alors que l'email est déjà parti. L'envoi
  // réel continue en arrière-plan côté Cloudflare via ctx.waitUntil.
  const envoiBrevo = fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": brevoApiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Scanner Merchi", email: EXPEDITEUR },
      to: [{ email: DESTINATAIRE }],
      subject: `Inventaire scanner — ${officine || "officine"} — ${date || ""}`,
      textContent: `Export automatique du scanner Merchi.\n\nOfficine : ${officine || "?"}\nDate : ${date || "?"}\nProduits : ${nb_total ?? "?"}\nFichier joint : ${nom_fichier} (renommé en .txt, Brevo n'accepte pas les pièces jointes .json — le contenu est identique, juste renommer l'extension en .json pour le réutiliser)`,
      // Brevo refuse les pièces jointes .json ("Unsupported file format")
      // — on renomme en .txt, contenu strictement identique.
      attachment: [{ name: nom_fichier.replace(/\.json$/i, ".txt"), content: contenu_base64 }],
    }),
  }).then(async (resp) => {
    if (!resp.ok) {
      const detail = await resp.text();
      console.error("Envoi Brevo échoué", detail);
    }
  }).catch((e) => {
    console.error("Erreur envoi Brevo", e.message);
  });

  ctx.waitUntil(envoiBrevo);

  return new Response(JSON.stringify({ ok: true, accepted: true }), { status: 200, headers: cors });
}
