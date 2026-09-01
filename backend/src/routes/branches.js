import { brandText } from "../config/brand.js";import { Router } from 'express';
import {
  listBranches,
  getBranch,
  createBranch,
  updateBranch,
  deleteBranch,
  reactivateBranch } from
'../repositories/branchesRepository.js';
import {
  requireAuth,
  requirePermission } from
'../middleware/auth.js';

const router = Router();

function normalize(body = {}) {
  const cp = String(body.cp ?? '').trim();
  const email = String(body.email ?? '').trim();

  if (cp && !/^\d{5}$/.test(cp)) throw new Error('INVALID_CP');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('INVALID_EMAIL');

  const phoneDigits = String(body.telefono ?? '').replace(/\D/g, '');
  if (phoneDigits && (phoneDigits.length < 10 || phoneDigits.length > 15)) {
    throw new Error('INVALID_PHONE');
  }

  return {
    id_sucursal: String(body.id_sucursal ?? '').trim(),
    nombre_sucursal: String(body.nombre_sucursal ?? '').trim(),
    codigo: String(body.codigo ?? '').trim(),
    direccion: String(body.direccion ?? '').trim(),
    ciudad: String(body.ciudad ?? '').trim(),
    municipio: String(body.municipio ?? body.ciudad ?? '').trim(),
    estado: String(body.estado ?? '').trim(),
    cp,
    colonia: String(body.colonia ?? '').trim(),
    pais: String(body.pais ?? 'México').trim(),
    telefono: String(body.telefono ?? '').trim(),
    email,
    activa: body.activa !== false
  };
}

const VALIDATION_MESSAGES = {
  BRANCH_NAME_REQUIRED: 'Ingresa el nombre de la sucursal.',
  BRANCH_STATE_REQUIRED: 'Selecciona el estado.',
  BRANCH_CITY_REQUIRED: 'Selecciona el municipio o ciudad.',
  BRANCH_CP_REQUIRED: 'Selecciona el código postal.',
  BRANCH_SETTLEMENT_REQUIRED: 'Selecciona la colonia o asentamiento.',
  INVALID_CP: 'El código postal debe contener 5 dígitos.',
  INVALID_EMAIL: 'Escribe un correo electrónico válido.',
  INVALID_PHONE: 'El teléfono debe contener entre 10 y 15 dígitos.'
};

function payload(code, message) {
  return { success: false, error: code, message };
}

function validateRequired(input) {
  if (!input.nombre_sucursal) return 'BRANCH_NAME_REQUIRED';
  if (!input.estado) return 'BRANCH_STATE_REQUIRED';
  if (!input.ciudad && !input.municipio) return 'BRANCH_CITY_REQUIRED';
  if (!input.cp) return 'BRANCH_CP_REQUIRED';
  if (!input.colonia) return 'BRANCH_SETTLEMENT_REQUIRED';
  return '';
}

function requireSuperadmin(req, res, next) {
  if (String(req.user?.rol || '').toUpperCase() !== 'SUPERADMIN') {
    return res.status(403).json({
      success: false,
      error: 'SUPERADMIN_REQUIRED',
      message: 'Solo SUPERADMIN puede crear o modificar sucursales.'
    });
  }
  next();
}

function scopeAllowsBranch(req, branch) {
  const scope = req.access?.branchScope;

  if (!scope || scope.all) return true;

  const branchId = String(branch?.id_sucursal || '').trim();
  return Boolean(
    branchId &&
    Array.isArray(scope.allowed) &&
    scope.allowed.includes(branchId)
  );
}

router.use(requireAuth);

router.get(
  '/',
  requirePermission('SUCURSALES', 'read'),
  async (req, res) => {
    try {
      const result = await listBranches({
        includeInactive: String(req.query.includeInactive ?? 'true') !== 'false'
      });

      const scope = req.access?.branchScope;
      const rows = !scope || scope.all ?
      result.rows :
      result.rows.filter((branch) => scopeAllowsBranch(req, branch));

      res.json({
        success: true,
        data: rows,
        count: rows.length,
        ms: result.ms
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'BRANCH_LIST_FAILED',
        message: error.message
      });
    }
  }
);

router.get(
  '/:rowId',
  requirePermission('SUCURSALES', 'read'),
  async (req, res) => {
    try {
      const branch = await getBranch(Number(req.params.rowId));

      if (!branch) {
        return res.status(404).json({
          success: false,
          error: 'BRANCH_NOT_FOUND'
        });
      }

      if (!scopeAllowsBranch(req, branch)) {
        return res.status(403).json({
          success: false,
          error: 'BRANCH_FORBIDDEN',
          message: 'La sucursal solicitada no pertenece al alcance del usuario.'
        });
      }

      res.json({ success: true, data: branch });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'BRANCH_GET_FAILED',
        message: error.message
      });
    }
  }
);

router.post(
  '/',
  requirePermission('SUCURSALES', 'read'),
  requireSuperadmin,
  async (req, res) => {
    try {
      const input = normalize(req.body);
      const required = validateRequired(input);

      if (required) {
        return res.status(400).json(
          payload(required, VALIDATION_MESSAGES[required])
        );
      }

      const branch = await createBranch(input);
      res.status(201).json({ success: true, data: branch });
    } catch (error) {
      const code = String(error.message || '');

      if (VALIDATION_MESSAGES[code]) {
        return res.status(400).json(
          payload(code, VALIDATION_MESSAGES[code])
        );
      }

      console.error(brandText("[GMX][BRANCH_CREATE]"), error);
      res.status(500).json(
        payload('BRANCH_CREATE_FAILED', 'No fue posible guardar la sucursal.')
      );
    }
  }
);

router.put(
  '/:rowId',
  requirePermission('SUCURSALES', 'read'),
  requireSuperadmin,
  async (req, res) => {
    try {
      const existing = await getBranch(Number(req.params.rowId));

      if (!existing) {
        return res.status(404).json(
          payload('BRANCH_NOT_FOUND', 'Sucursal no encontrada.')
        );
      }

      const input = normalize(req.body);
      const required = validateRequired(input);

      if (required) {
        return res.status(400).json(
          payload(required, VALIDATION_MESSAGES[required])
        );
      }

      const branch = await updateBranch(Number(req.params.rowId), input);

      if (!branch) {
        return res.status(404).json(
          payload('BRANCH_NOT_FOUND', 'Sucursal no encontrada.')
        );
      }

      res.json({ success: true, data: branch });
    } catch (error) {
      const code = String(error.message || '');

      if (VALIDATION_MESSAGES[code]) {
        return res.status(400).json(
          payload(code, VALIDATION_MESSAGES[code])
        );
      }

      console.error(brandText("[GMX][BRANCH_UPDATE]"), error);
      res.status(500).json(
        payload('BRANCH_UPDATE_FAILED', 'No fue posible actualizar la sucursal.')
      );
    }
  }
);


router.patch(
  '/:rowId/reactivate',
  requirePermission('SUCURSALES', 'read'),
  requireSuperadmin,
  async (req, res) => {
    try {
      const branch = await reactivateBranch(Number(req.params.rowId));

      if (!branch) {
        return res.status(404).json(
          payload('BRANCH_NOT_FOUND', 'Sucursal no encontrada.')
        );
      }

      res.json({
        success: true,
        data: branch,
        message: 'Sucursal reactivada.'
      });
    } catch (error) {
      console.error(brandText("[GMX][BRANCH_REACTIVATE]"), error);
      res.status(500).json(
        payload('BRANCH_REACTIVATE_FAILED', 'No fue posible reactivar la sucursal.')
      );
    }
  }
);

router.delete(
  '/:rowId',
  requirePermission('SUCURSALES', 'read'),
  requireSuperadmin,
  async (req, res) => {
    try {
      const existing = await getBranch(Number(req.params.rowId));
      if (!existing) {
        return res.status(404).json(
          payload('BRANCH_NOT_FOUND', 'Sucursal no encontrada.')
        );
      }

      const branch = await deleteBranch(Number(req.params.rowId));
      res.json({
        success: true,
        data: branch,
        message: 'Sucursal eliminada de la operación activa.'
      });
    } catch (error) {
      console.error(brandText("[GMX][BRANCH_DELETE]"), error);
      res.status(500).json(
        payload('BRANCH_DELETE_FAILED', 'No fue posible eliminar la sucursal.')
      );
    }
  }
);

export default router;
