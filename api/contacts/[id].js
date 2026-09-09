const { query } = require('../../lib/db');
const { requireAuth, cors, hasAnyRole, requireWriteAny } = require('../../lib/auth');

// Os contactos são globais: não pertencem a nenhuma marca. O acesso exige
// apenas que o utilizador pertença a alguma marca — a mesma verificação que
// as listas usam. (Antes cruzava-se contacts.brand_id com user_brand_roles, o
// que deixaria de encontrar qualquer contacto sem marca.)
async function authorizeContact(userId, contactId) {
  if (!await hasAnyRole(userId)) return null;
  const r = await query(`SELECT c.* FROM contacts c WHERE c.id = $1`, [contactId]);
  return r[0] || null;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = await requireAuth(req, res);
  if (!user) return;

  const { id } = req.query;

  try {
    const contact = await authorizeContact(user.id, id);
    if (!contact) return res.status(404).json({ error: 'Contacto não encontrado' });

    if (req.method === 'GET') {
      const lists = await query(
        `SELECT l.id, l.name FROM lists l
         JOIN list_members lm ON lm.list_id = l.id WHERE lm.contact_id = $1`, [id]
      );
      const events = await query(
        `SELECT ee.type, ee.url, ee.created_at, c.name AS campaign_name
         FROM email_events ee JOIN campaigns c ON c.id = ee.campaign_id
         WHERE ee.contact_id = $1 ORDER BY ee.created_at DESC LIMIT 20`, [id]
      );
      return res.status(200).json({ ...contact, lists, events });
    }

    if (req.method === 'PUT') {
      const { email, name, phone, company, status, custom_attributes } = req.body || {};
      const novoEmail = email?.toLowerCase().trim() || null;
      // Um email é um contacto: mudar para um que já existe fundiria dois
      // contactos sem o pedir. Recusa-se com uma mensagem em vez de deixar o
      // índice único responder com um erro de servidor.
      if (novoEmail && novoEmail !== String(contact.email || '').toLowerCase()) {
        const [ja] = await query(
          'SELECT id FROM contacts WHERE LOWER(email)=$1 AND id<>$2 LIMIT 1', [novoEmail, id]
        );
        if (ja) return res.status(409).json({ error: 'Já existe um contacto com esse email.' });
      }
      await query(
        `UPDATE contacts SET
           email=COALESCE($1,email), name=$2,
           phone=COALESCE($3,phone), company=COALESCE($4,company),
           status=COALESCE($5,status),
           custom_attributes=COALESCE($6,custom_attributes), updated_at=NOW()
         WHERE id=$7`,
        [email?.toLowerCase().trim()||null, name||null, phone||null, company||null,
         status||null, custom_attributes ? JSON.stringify(custom_attributes) : null, id]
      );
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      if (!await requireWriteAny(req, res, user.id)) return;   // S-8
      // G-1: o email fica em email_send_log (NOT NULL, FK a SET NULL) depois de
      // o contacto ser apagado — dado pessoal que sobrevive ao apagamento.
      // Anonimizar preserva a utilidade forense (houve envio) sem o email.
      try {
        await query("UPDATE email_send_log SET email = 'apagado@' || md5(email), contact_id = NULL WHERE contact_id = $1", [id]);
      } catch (e) { if (e.code !== '42P01') throw e; }
      // email_events.contact_id não tem ON DELETE definido — anular primeiro.
      await query('UPDATE email_events SET contact_id=NULL WHERE contact_id = $1', [id]);
      await query('DELETE FROM contacts WHERE id = $1', [id]);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor' });
  }
};
