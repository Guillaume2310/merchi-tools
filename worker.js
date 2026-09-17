// worker.js — Merchi (redeploy pour prise en compte du secret RESEND_API_KEY)
// ─────────────────────────────────────────────────────────────
// Sert le site statique (scanner) normalement, et ajoute un point
// d'entrée /api/envoyer-inventaire qui reçoit un export du scanner
// et l'envoie automatiquement par email (via Resend) à
// fichierpara@merchi-pharma.fr, en pièce jointe.
//
// Nécessite un binding "Secrets Store" nommé RESEND_API_KEY, configuré
// dans Cloudflare : Workers & Pages → merchi-tools → Bindings → Add →
// Secrets Store → RESEND_API_KEY (voir secrets_store_secrets dans
// wrangler.jsonc). Ce type de binding s'utilise avec .get() (async),
// pas comme une simple variable texte.

const DESTINATAIRE = "fichierpara@merchi-pharma.fr";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/envoyer-inventaire" && request.method === "POST") {
      return envoyerInventaire(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function envoyerInventaire(request, env) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (!env.RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY non configurée côté serveur" }), { status: 500, headers: cors });
  }
  let resendApiKey;
  try {
    resendApiKey = await env.RESEND_API_KEY.get();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Lecture du secret RESEND_API_KEY impossible", detail: e.message }), { status: 500, headers: cors });
  }
  if (!resendApiKey) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY vide" }), { status: 500, headers: cors });
  }

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

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Scanner Merchi <onboarding@resend.dev>",
        to: DESTINATAIRE,
        subject: `Inventaire scanner — ${officine || "officine"} — ${date || ""}`,
        text: `Export automatique du scanner Merchi.\n\nOfficine : ${officine || "?"}\nDate : ${date || "?"}\nProduits : ${nb_total ?? "?"}\nFichier joint : ${nom_fichier}`,
        attachments: [{ filename: nom_fichier, content: contenu_base64 }],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return new Response(JSON.stringify({ error: "Envoi Resend échoué", detail }), { status: 502, headers: cors });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
