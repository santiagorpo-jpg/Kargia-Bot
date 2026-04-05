import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const {
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID,
  VERIFY_TOKEN,
  ANTHROPIC_API_KEY,
  ADMIN_PHONE,
} = process.env;

const sessions = {};
function getSession(phone) {
  if (!sessions[phone]) {
    sessions[phone] = { history: [], humanMode: false, lastActivity: new Date() };
  }
  sessions[phone].lastActivity = new Date();
  return sessions[phone];
}
setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  for (const p in sessions) if (sessions[p].lastActivity < cutoff) delete sessions[p];
}, 30 * 60 * 1000);

const SYSTEM_PROMPT = `Eres Santiago, asesor comercial de KARGIA, empresa de instalacion de cargadores electricos para vehiculos en Medellin y el Area Metropolitana.

Tu nombre es Santiago. Eres una persona real, no un robot.
Hablas de forma natural, como un asesor paisa amable y profesional.
Usas el nombre del cliente apenas lo sepas, en cada mensaje.
NUNCA digas que eres un bot, una IA, un asistente virtual ni nada similar.
Maximo 4-5 lineas por mensaje. Una sola pregunta por mensaje.

DATOS A RECOGER EN ORDEN:
1. Nombre del cliente
2. Ciudad o municipio
3. Tipo de inmueble (casa, apartamento, local)
4. Marca y modelo del vehiculo electrico
5. Tipo de cargador (Nivel 1, Nivel 2, DC)

ZONAS DE COBERTURA: Medellin, Envigado, Sabaneta, Itagui, Bello, Copacabana, La Estrella, Caldas, Barbosa, Girardota, Rionegro. Si esta fuera, dile que no hay cobertura.

CALCULO DE DISTANCIA:
Para casas y locales: pregunta metros entre tablero y punto de carga.
Para apartamentos: pregunta piso del apto, si el medidor esta en el piso o sotano, nivel del parqueadero y metros horizontales en sotano.
Distancia vertical = pisos de diferencia x 3 metros. Si no sabe usa 20 metros.

PRECIOS:
70000 COP por metro lineal mas IVA 19%. Minimo 15 metros.
Cable 8 hasta 40m, cable 6 mas de 40m.
Metros a facturar = MAX(metros, 15). Subtotal = metros x 70000. IVA = Subtotal x 19%. TOTAL = Subtotal + IVA.

Cuando tengas todos los datos presenta la cotizacion con el formato de items incluidos, precio estimado y oferta de visita tecnica gratuita.

Si el cliente pide hablar con persona o hay queja escribe exactamente: [TRANSFER_TO_HUMAN]`;

async function askClaude(phone, userMessage) {
  const session = getSession(phone);
  session.history.push({ role: "user", content: userMessage });
  if (session.history.length > 30) session.history = session.history.slice(-30);

  console.log("Llamando Claude para:", phone);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: session.history,
    }),
  });

  const data = await res.json();
  console.log("Claude status:", res.status);
  console.log("Claude data:", JSON.stringify(data).substring(0, 300));

  const reply = (data.content && data.content[0] && data.content[0].text)
    ? data.content[0].text
    : "Disculpa, tuve un problema tecnico. Me repites lo que me decias?";

  session.history.push({ role: "assistant", content: reply });
  return reply;
}

async function sendWhatsApp(to, message) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message },
    }),
  });
  const data = await res.json();
  console.log("WA send:", res.status, JSON.stringify(data).substring(0, 150));
}

async function handleAdminCommand(text, adminPhone) {
  const parts = text.trim().split(" ");
  const cmd = parts[0];
  const target = parts[1];
  if (cmd === "#tomar" && target) {
    getSession(target).humanMode = true;
    await sendWhatsApp(adminPhone, "Tomaste el control con " + target + ". Escribe #liberar " + target + " para reactivar.");
    await sendWhatsApp(target, "Te paso con un asesor ahora mismo, un momento!");
    return true;
  }
  if (cmd === "#liberar" && target) {
    getSession(target).humanMode = false;
    await sendWhatsApp(adminPhone, "Bot reactivado para " + target);
    return true;
  }
  if (cmd === "#sesiones") {
    const n = Object.keys(sessions).length;
    await sendWhatsApp(adminPhone, "Conversaciones activas: " + n);
    return true;
  }
  return false;
}

app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    console.log("Webhook verificado");
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhook", (req, res) => {
  res.sendStatus(200);
  const value = req.body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (!msg) return;
  const from = msg.from;
  console.log("Msg de:", from, "tipo:", msg.type);

  (async () => {
    try {
      if (from === ADMIN_PHONE && msg.text?.body?.startsWith("#")) {
        await handleAdminCommand(msg.text.body, ADMIN_PHONE);
        return;
      }
      const session = getSession(from);
      if (session.humanMode && from !== ADMIN_PHONE) {
        await sendWhatsApp(ADMIN_PHONE, "Cliente " + from + ":\n" + (msg.text?.body || "[archivo]"));
        return;
      }
      if (msg.type !== "text") {
        const r = await askClaude(from, "[El cliente envio una foto o archivo]");
        await sendWhatsApp(from, r);
        return;
      }
      const text = msg.text?.body?.trim();
      if (!text) return;
      console.log("Procesando:", text);
      const reply = await askClaude(from, text);
      console.log("Reply:", reply.substring(0, 100));
      if (reply.includes("[TRANSFER_TO_HUMAN]")) {
        session.humanMode = true;
        const clean = reply.replace("[TRANSFER_TO_HUMAN]", "").trim();
        if (clean) await sendWhatsApp(from, clean);
        await sendWhatsApp(ADMIN_PHONE, "ALERTA - Cliente " + from + " pide atencion humana. Escribe: #tomar " + from);
      } else {
        await sendWhatsApp(from, reply);
      }
    } catch (err) {
      console.error("ERROR:", err.message);
      console.error("STACK:", err.stack);
    }
  })();
});

app.get("/", (_, res) => res.send("Kargia Bot v4 activo"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("Kargia Bot corriendo en puerto " + PORT));
