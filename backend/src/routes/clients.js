import { brandText } from "../config/brand.js";import { Router } from 'express';
import {
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient } from
'../repositories/clientsRepository.js';

const router = Router();

function normalize(body = {}) {
  const cp = String(body.cp ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const telefono = String(body.telefono ?? '').trim();
  const rfc = String(body.rfc ?? '').trim().toUpperCase();
  const cpFiscal = String(body.cp_fiscal ?? '').trim();

  if (cp && !/^\d{5}$/.test(cp)) throw new Error('INVALID_CP');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('INVALID_EMAIL');

  // Regla global Shiny: teléfono = únicamente 0-9.
  if (telefono && !/^\d+$/.test(telefono)) throw new Error('PHONE_DIGITS_ONLY');
  if (telefono && (telefono.length < 10 || telefono.length > 15)) throw new Error('INVALID_PHONE_LENGTH');

  if (rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) throw new Error('INVALID_RFC');
  if (cpFiscal && !/^\d{5}$/.test(cpFiscal)) throw new Error('INVALID_FISCAL_CP');

  return {
    nombre: String(body.nombre ?? '').trim(),
    telefono,
    email,
    direccion: String(body.direccion ?? '').trim(),
    ciudad: String(body.ciudad ?? '').trim(),
    estado: String(body.estado ?? '').trim(),
    municipio: String(body.municipio ?? body.ciudad ?? '').trim(),
    colonia: String(body.colonia ?? '').trim(),
    cp,
    pais: String(body.pais ?? 'México').trim(),
    rfc,
    razon_social: String(body.razon_social ?? '').trim(),
    regimen_fiscal: String(body.regimen_fiscal ?? '').trim(),
    cp_fiscal: cpFiscal,
    uso_cfdi: String(body.uso_cfdi ?? '').trim()
  };
}

const CLIENT_MESSAGES = {
  CLIENT_NAME_REQUIRED: 'Ingresa el nombre del cliente.',
  CLIENT_IDENTITY_REQUIRED: 'Captura al menos correo electrónico o teléfono.',
  INVALID_CP: 'Selecciona un código postal válido.',
  INVALID_EMAIL: 'Escribe un correo electrónico válido.',
  PHONE_DIGITS_ONLY: 'El teléfono solo puede contener números del 0 al 9.',
  INVALID_PHONE_LENGTH: 'El teléfono debe contener entre 10 y 15 dígitos.',
  INVALID_RFC: 'El RFC no tiene un formato válido.',
  INVALID_FISCAL_CP: 'El CP fiscal debe contener 5 dígitos.',
  CLIENT_EMAIL_ALREADY_LINKED: 'Ese correo ya pertenece a otro cliente. Recupera o edita la cuenta existente.',
  CLIENT_PHONE_ALREADY_LINKED: 'Ese teléfono ya pertenece a otro cliente. Recupera o edita la cuenta existente.'
};

function clientErrorCode(error) {
  const msg = String(error?.message || '');
  if (msg.includes('uq_clientes_email_normalizado') || msg.includes('email_normalizado')) return 'CLIENT_EMAIL_ALREADY_LINKED';
  if (msg.includes('uq_clientes_telefono_normalizado') || msg.includes('telefono_normalizado')) return 'CLIENT_PHONE_ALREADY_LINKED';
  return Object.keys(CLIENT_MESSAGES).find((code) => msg.includes(code)) || '';
}



router.get('/', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const result = await listClients({ search, limit, offset });

    res.json({
      success: true,
      data: result.rows,
      count: result.rowCount,
      limit,
      offset,
      ms: result.ms
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'CLIENT_LIST_FAILED',
      message: error.message
    });
  }
});

router.get('/:rowId', async (req, res) => {
  try {
    const client = await getClient(Number(req.params.rowId));

    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'CLIENT_NOT_FOUND'
      });
    }

    res.json({ success: true, data: client });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'CLIENT_GET_FAILED',
      message: error.message
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const input = normalize(req.body);

    if (!input.nombre) return res.status(400).json({ success: false, error: 'CLIENT_NAME_REQUIRED', message: CLIENT_MESSAGES.CLIENT_NAME_REQUIRED });
    if (!input.email && !input.telefono) return res.status(400).json({ success: false, error: 'CLIENT_IDENTITY_REQUIRED', message: CLIENT_MESSAGES.CLIENT_IDENTITY_REQUIRED });

    const client = await createClient(input);

    res.status(201).json({
      success: true,
      data: client
    });
  } catch (error) {
    const code = clientErrorCode(error);
    if (code) return res.status(400).json({ success: false, error: code, message: CLIENT_MESSAGES[code] });
    console.error(brandText("[GMX][CLIENT_CREATE]"), error);
    res.status(500).json({ success: false, error: 'CLIENT_CREATE_FAILED', message: 'No fue posible crear el cliente.' });
  }
});


router.put('/:rowId', async (req, res) => {
  try {
    const input = normalize(req.body);
    if (!input.nombre) return res.status(400).json({ success: false, error: 'CLIENT_NAME_REQUIRED', message: CLIENT_MESSAGES.CLIENT_NAME_REQUIRED });
    if (!input.email && !input.telefono) return res.status(400).json({ success: false, error: 'CLIENT_IDENTITY_REQUIRED', message: CLIENT_MESSAGES.CLIENT_IDENTITY_REQUIRED });
    const client = await updateClient(Number(req.params.rowId), input);

    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'CLIENT_NOT_FOUND'
      });
    }

    res.json({ success: true, data: client });
  } catch (error) {
    const code = clientErrorCode(error);
    if (code) return res.status(400).json({ success: false, error: code, message: CLIENT_MESSAGES[code] });
    console.error(brandText("[GMX][CLIENT_UPDATE]"), error);
    res.status(500).json({ success: false, error: 'CLIENT_UPDATE_FAILED', message: 'No fue posible actualizar el cliente.' });
  }
});


router.delete('/:rowId', async (req, res) => {
  try {
    const deleted = await deleteClient(Number(req.params.rowId));

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'CLIENT_NOT_FOUND'
      });
    }

    res.json({ success: true, data: deleted });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'CLIENT_DELETE_FAILED',
      message: error.message
    });
  }
});

export default router;
