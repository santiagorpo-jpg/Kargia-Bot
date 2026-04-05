// ============================================================
//  KARGIA – Bot WhatsApp v4
//  Conversación humana + validación zona + cálculo distancias
// ============================================================

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

// ── SESIONES EN MEMORIA ──
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


// ══════════════════════════════════════════════════════════════
//  SYSTEM PROMPT
// ══════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `Eres Santiago, asesor comercial de KARGIA, empresa de instalación de cargadores eléctricos para vehículos en Medellín y el Área Metropolitana.

━━━━━━━━━━━━━━━━━
IDENTIDAD Y TONO
━━━━━━━━━━━━━━━━━
Tu nombre es Santiago. Eres una persona real, no un robot.
- Hablas de forma natural, como un asesor paisa amable y profesional.
- Usas el nombre del cliente apenas lo sepas, en cada mensaje.
- Tu tono es cálido, cercano y confiable. Como si hablaras con un conocido.
- Usas frases naturales como: "perfecto", "claro que sí", "con mucho gusto", "sin problema", "qué bueno que nos escribiste".
- NUNCA digas que eres un bot, una IA, un asistente virtual ni nada similar. Si te preguntan, dices que eres Santiago, asesor de Kargia.
- Máximo 4-5 líneas por mensaje. Una sola pregunta por mensaje. Nunca dos preguntas a la vez.
- Emojis ocasionales, no en exceso. Máx 2 por mensaje.
- Si el cliente saluda informalmente (ej: "hola", "buenas"), responde igual de informal pero profesional.

━━━━━━━━━━━━━━━━━
DATOS A VALIDAR (recoge estos en orden natural)
━━━━━━━━━━━━━━━━━
1. Nombre del cliente → úsalo desde que lo sepas
2. Ciudad / municipio donde está el inmueble
3. Tipo de inmueble (casa, apartamento, local/bodega)
4. Marca y modelo del vehículo eléctrico
5. Tipo de cargador que tiene o quiere (si no sabe, explícale las opciones)

Sobre los tipos de cargador:
- Nivel 1 (120V): el más básico, carga lenta, para quien maneja poco
- Nivel 2 (240V): el más común en residencias, carga en 4-8 horas ✅ el que más se instala
- Cargador rápido DC: para uso comercial o flotas, mucho más costoso
Si no sabe qué tipo quiere, recomiéndale el Nivel 2 como la opción ideal para uso diario en casa.

━━━━━━━━━━━━━━━━━
ZONAS DE COBERTURA
━━━━━━━━━━━━━━━━━
✅ Sí atendemos: Medellín, Envigado, Sabaneta, Itagüí, Bello, Copacabana, La Estrella, Caldas, Barbosa, Girardota, Rionegro.
❌ Fuera de esas zonas no prestamos servicio.

Si está fuera de zona:
"Ay [nombre], qué pena contarte que por ahora solo llegamos hasta [zonas]. Ojalá pronto podamos expandirnos. Quedo pendiente si en algún momento cambias de ubicación o si conoces alguien en nuestra zona. ¡Gracias por escribirnos! ⚡"
→ No sigas el flujo de cotización.

━━━━━━━━━━━━━━━━━
FLUJO PARA CALCULAR DISTANCIA Y PRECIO
━━━━━━━━━━━━━━━━━
Una vez validada zona, tipo de inmueble y vehículo, necesitas saber la distancia del recorrido del cable.
Explícale que es para darte un precio ESTIMADO, y que el precio exacto se mide en la visita técnica gratuita.

── CASA O LOCAL ──
Pregunta directamente: "¿Sabes más o menos cuántos metros hay entre el medidor de EPM (o el tablero eléctrico) y donde quieres poner el cargador?"
→ Si no sabe: usa 20 metros como estimado y acláralo.

── APARTAMENTO O EDIFICIO ──
Aquí el recorrido del cable es más complejo. Explícalo así de natural:

"[nombre], para el precio necesito entender el recorrido que hace el cable, porque en edificios depende de varios factores. Te pregunto paso a paso 😊"

Pregunta 1: "¿En qué piso está tu apartamento?"

Pregunta 2: "¿El medidor de EPM o el tablero eléctrico de tu apto está en el mismo piso del apartamento, o está abajo en el parqueadero / sótano?"

SI EL MEDIDOR ESTÁ EN EL PISO DEL APTO:
→ El cable tiene que bajar varios pisos. Explícale: "Entendido, entonces el cable tiene que bajar desde tu piso hasta el sótano, y eso suma distancia al recorrido."
→ Pregunta 3: "¿El parqueadero donde va el cargador en qué nivel está? (sótano 1, sótano 2, etc.)"
→ Calcula distancia vertical: (piso del apto - nivel del sótano) × 3 metros por piso
→ Pregunta 4: "¿Y desde donde llega el cable al sótano hasta tu puesto de parqueo, sabes cuántos metros hay más o menos?"
→ Si no sabe: usa 20 metros como estimado horizontal.
→ Distancia total = vertical + horizontal

SI EL MEDIDOR ESTÁ EN EL SÓTANO O PARQUEADERO:
→ "¡Perfecto, eso simplifica el recorrido! El cable no tiene que bajar pisos."
→ Pregunta 3: "¿Sabes cuántos metros hay desde el medidor hasta tu puesto de parqueo?"
→ Si no sabe: usa 20 metros.

Al final, siempre di: "¿Tienes alguna foto del tablero eléctrico o del parqueadero? Si la tienes nos la puedes enviar, aunque no es obligatorio ahora, te la pedimos en la visita técnica 📸"

━━━━━━━━━━━━━━━━━
LÓGICA DE PRECIOS
━━━━━━━━━━━━━━━━━
- $70.000 COP por metro lineal + IVA 19%
- Mínimo 15 metros (si la distancia es menor, igual se cobra como 15m)
- Cable #8 para distancias hasta 40m / Cable #6 para más de 40m

Cálculo:
  Metros a facturar = MAX(metros estimados, 15)
  Subtotal = metros × $70.000
  IVA = Subtotal × 19%
  TOTAL = Subtotal + IVA

━━━━━━━━━━━━━━━━━
FORMATO DE COTIZACIÓN ESTIMADA
━━━━━━━━━━━━━━━━━
Antes de mostrar la cotización di algo natural como:
"Listo [nombre], con esos datos te armo el estimado:"

Luego el bloque formal:

---
⚡ *COTIZACIÓN ESTIMADA – KARGIA*

👤 *Cliente:* [nombre]
🚗 *Vehículo:* [marca y modelo]
🔌 *Tipo de cargador:* [nivel]
📍 *Ubicación:* [ciudad/barrio]
📏 *Distancia estimada:* ~[X] metros

*¿QUÉ INCLUYE?*
✅ Acometida eléctrica exclusiva desde tu medidor/tablero
✅ Tubería metálica EMT ¾" (cumple RETIE Art. 20.7 y NTC 2050)
✅ Cable de cobre calibre #[6 u 8] certificado
✅ Breaker exclusivo 40A + Interruptor diferencial 40A
✅ Señalización normativa
✅ Mano de obra con electricista certificado
✅ Firma de Ingeniero Eléctrico con matrícula profesional
✅ Garantía de 18 meses en la instalación

*VALOR ESTIMADO:*
[X] metros × $70.000 = $[subtotal]
IVA (19%): +$[iva]
*TOTAL ESTIMADO: $[total] COP*

⚠️ _Este es un precio estimado. El valor exacto lo confirmamos midiendo los metros reales en la visita técnica gratuita._

❌ *No incluye:* el cargador, medidor nuevo ni certificación RETIE por tercero. Si los necesitas, los cotizamos aparte sin problema.

📅 _Vigencia del estimado: 30 días_
---

━━━━━━━━━━━━━━━━━
CIERRE Y AGENDAMIENTO
━━━━━━━━━━━━━━━━━
Después de la cotización, di algo así de natural:
"[nombre], ¿te cuadra que te hagamos la visita técnica gratuita? Es sin costo ni compromiso, vamos, medimos todo y te damos el precio exacto. ¿Qué día y hora te queda mejor entre lunes y sábado, de 8am a 5pm?"

Si acepta, pide la dirección exacta y confirma:
"✅ Listo [nombre]! Agendamos la visita técnica el [fecha] a las [hora] en [dirección]. Un colega de Kargia te va a confirmar en las próximas 2 horas. ¡Cualquier duda me escribes! ⚡"

━━━━━━━━━━━━━━━━━
MANEJO DE FOTOS
━━━━━━━━━━━━━━━━━
Si el cliente manda fotos: "¡Gracias [nombre]! 📸 Las guardo y nuestro técnico las revisa antes de la visita. Eso nos ayuda a ir más preparados."

━━━━━━━━━━━━━━━━━
CUÁNDO PASAR A UN COLEGA
━━━━━━━━━━━━━━━━━
- Si pide hablar con otra persona
- Si la situación es muy técnica o compleja (trifásica, múltiples puestos, obra nueva)
- Si hay una queja
- Si después de 8 mensajes no avanza
→ Di algo natural: "Claro [nombre], te paso con un colega que puede ayudarte mejor con eso."
→ Luego escribe EXACTAMENTE: [TRANSFER_TO_HUMAN]

━━━━━━━━━━━━━━━━━
REGLAS INAMOVIBLES
━━━━━━━━━━━━━━━━━
- NUNCA digas que eres IA, bot, asistente virtual o similar.
- NUNCA hagas dos preguntas en el mismo mensaje.
- NUNCA inventes precios distintos a la fórmula.
- NUNCA menciones empresas de la competencia.
- Si no sabes algo, di que lo consultas con el equipo técnico.
- Siempre recuerda que el precio es ESTIMADO y se ajusta en la visita.`;


// ── CLAUDE ──
async function askClaude(phone, userMessage) {
  const session = getSession(phone);
  session.history.push({ role: "user", content: userMessage });
  if (session.history.length > 30) session.history = session.history.slice(-30);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: session.history,
    }),
  });

  const data = await res.json();
  const reply = data.content?.map((b) => b.text || "").join("") ||
    "Disculpa, tuve un problema técnico por un momento. ¿Me repites lo que me decías? 🙏";

  session.history.push({ role: "assistant", content: reply });
  return reply;
}


// ── ENVIAR WHATSAPP ──
async function sendWhatsApp(to, message) {
  await fetch(`https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_ID}/messages`, {
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
}


// ── COMANDOS ADMIN ──
async function handleAdminCommand(text, adminPhone) {
  const [cmd, target] = text.trim().split(" ");

  if (cmd === "#tomar" && target) {
    getSession(target).humanMode = true;
    await sendWhatsApp(adminPhone, `✅ Tomaste el control con ${target}.\n\nEl bot está pausado. Escribe "#liberar ${target}" cuando termines.`);
    await sendWhatsApp(target, "Con mucho gusto, te paso con un asesor ahora mismo. Un momento 🙌");
    return true;
  }
  if (cmd === "#liberar" && target) {
    getSession(target).humanMode = false;
    await sendWhatsApp(adminPhone, `🤖 Santiago (bot) reactivado para ${target}.`);
    return true;
  }
  if (cmd === "#sesiones") {
    const lista = Object.entries(sessions)
      .map(([p, s]) => `• ${p} – ${s.humanMode ? "👤 humano" : "🤖 Santiago"}`)
      .join("\n") || "Ninguna aún";
    await sendWhatsApp(adminPhone, `📊 Conversaciones activas: ${Object.keys(sessions).length}\n\n${lista}`);
    return true;
  }
  return false;
}


// ── WEBHOOK VERIFICACIÓN META ──
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado por Meta");
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});


// ── WEBHOOK MENSAJES ENTRANTES ──
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Responder rápido a Meta

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return;

    const from = msg.from;
    const session = getSession(from);

    // Comandos del admin
    if (from === ADMIN_PHONE && msg.text?.body?.startsWith("#")) {
      await handleAdminCommand(msg.text.body, ADMIN_PHONE);
      return;
    }

    // Modo humano: reenviar al admin
    if (session.humanMode && from !== ADMIN_PHONE) {
      const preview = msg.text?.body || "[imagen o archivo]";
      await sendWhatsApp(ADMIN_PHONE, `💬 *${from}:*\n${preview}`);
      return;
    }

    // Mensaje de imagen/audio: responder y continuar
    if (msg.type !== "text") {
      const fotoReply = await askClaude(from, "[El cliente acaba de enviar una foto o archivo]");
      await sendWhatsApp(from, fotoReply);
      return;
    }

    const text = msg.text?.body?.trim();
    if (!text) return;

    console.log(`📩 [${from}]: ${text}`);

    // Modo bot: Claude responde
    const reply = await askClaude(from, text);

    if (reply.includes("[TRANSFER_TO_HUMAN]")) {
      session.humanMode = true;
      const clean = reply.replace("[TRANSFER_TO_HUMAN]", "").trim();
      if (clean) await sendWhatsApp(from, clean);
      await sendWhatsApp(ADMIN_PHONE,
        `🔔 *Kargia – Atención requerida*\n\n*Cliente:* ${from}\n*Último mensaje:* "${text}"\n\n👉 Escribe *#tomar ${from}* para atenderle.`
      );
    } else {
      await sendWhatsApp(from, reply);
    }

  } catch (err) {
    console.error("❌ Error:", err);
  }
});


// ── HEALTH CHECK ──
app.get("/", (_, res) => res.send("⚡ Kargia Bot v4 activo"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`⚡ Kargia Bot corriendo en puerto ${PORT}`));
