import { z } from 'zod';
import {
  bookingSchema,
  changePasswordSchema,
  clientSchema,
  convertLeadSchema,
  dprSchema,
  interactionSchema,
  leadActivitySchema,
  leadSchema,
  loginSchema,
  materialSchema,
  materialUsageSchema,
  milestoneSchema,
  paymentSchema,
  projectSchema,
  propertyImportSchema,
  propertySchema,
  purchaseSchema,
  settingsSchema,
  stageProgressSchema,
  stockAdjustmentSchema,
  workerSchema,
  attendanceDaySchema,
} from '@shared/schemas';
import { DEFAULT_STAGES } from '@shared/constants';
import { ATTENDANCE_WEIGHT, type AttendanceStatus } from '@shared/constants';
import type { GlobalSearchHit } from '@shared/types';
import { db, nextId, parseDatabase, replaceDatabase, save, serialiseDatabase } from './db';
import { createSession, endSession, hashPassword, userForToken, verifyPassword } from './auth';
import { byId, dayKey, endOfDay, listRows, round, startOfDay, type Query } from './query';
import { stockRows } from './services/stock';
import { dashboardAlerts, dashboardCharts, dashboardSummary } from './services/dashboard';
import { buildAllForecasts, buildForecast } from './services/forecast';
import { REPORTS, buildReport } from './services/reports';
import type { AttendanceRow, DprRow } from './types';

/** An error carrying the HTTP status the UI already knows how to display. */
export class LocalApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'LocalApiError';
  }
}

const notFound = (what: string): LocalApiError => new LocalApiError(404, `${what} not found.`);
const badRequest = (message: string): LocalApiError => new LocalApiError(400, message);

export interface Context {
  params: Record<string, string>;
  query: Query;
  body: unknown;
  form?: FormData;
  token: string | null;
}

const SETTINGS_KEY = 'app.settings';

export function readSettings(): ReturnType<typeof settingsSchema.parse> {
  const defaults = settingsSchema.parse({ companyName: 'Aasma Construction', currency: '₹' });
  const row = db().settings.find((item) => item.key === SETTINGS_KEY);
  if (!row) return defaults;
  try {
    return settingsSchema.parse({ ...defaults, ...JSON.parse(row.value) });
  } catch {
    return defaults;
  }
}

function writeSettings(value: unknown): ReturnType<typeof settingsSchema.parse> {
  const parsed = settingsSchema.parse(value);
  const data = db();
  const existing = data.settings.find((item) => item.key === SETTINGS_KEY);
  if (existing) {
    existing.value = JSON.stringify(parsed);
    existing.updatedAt = new Date();
  } else {
    data.settings.push({ key: SETTINGS_KEY, value: JSON.stringify(parsed), updatedAt: new Date() });
  }
  save('settings');
  return parsed;
}

function requireUser(context: Context): { id: number; username: string; fullName: string; role: string } {
  const user = userForToken(context.token);
  if (!user) throw new LocalApiError(401, 'Sign in to continue.');
  return user;
}

function logActivity(actor: string, action: string, entity: string, entityId?: number | string, detail?: string): void {
  const data = db();
  data.activityLogs.push({
    id: nextId(data.activityLogs),
    actor,
    action,
    entity,
    entityId: entityId != null ? String(entityId) : null,
    detail: detail ?? null,
    createdAt: new Date(),
  });
  if (data.activityLogs.length > 500) data.activityLogs = data.activityLogs.slice(-500);
  save('activityLogs');
}

const num = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// ------------------------------------------------------------------ auth

export const handlers: Record<string, (context: Context) => unknown | Promise<unknown>> = {
  'POST /auth/login': async (context) => {
    const { username, password } = loginSchema.parse(context.body);
    const data = db();
    const user = data.users.find((row) => row.username === username.toLowerCase());
    if (!user || !user.active) throw new LocalApiError(401, 'Incorrect username or password.');
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw new LocalApiError(401, 'Incorrect username or password.');
    }
    user.lastLoginAt = new Date();
    save('users');
    const token = createSession(user.id);
    logActivity(user.username, 'LOGIN', 'User', user.id);
    return { token, user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role } };
  },

  'GET /auth/me': (context) => requireUser(context),

  'POST /auth/logout': (context) => {
    endSession(context.token);
    return { ok: true };
  },

  'POST /auth/change-password': async (context) => {
    const user = requireUser(context);
    const { currentPassword, newPassword } = changePasswordSchema.parse(context.body);
    const data = db();
    const row = data.users.find((item) => item.id === user.id);
    if (!row) throw notFound('User');
    if (!(await verifyPassword(currentPassword, row.passwordHash))) {
      throw new LocalApiError(401, 'Your current password is not correct.');
    }
    row.passwordHash = await hashPassword(newPassword);
    row.updatedAt = new Date();
    save('users');
    logActivity(user.username, 'CHANGE_PASSWORD', 'User', user.id);
    return { ok: true };
  },

  // ---------------------------------------------------------------- dashboard
  'GET /dashboard/summary': (context) => {
    requireUser(context);
    return dashboardSummary();
  },
  'GET /dashboard/charts': (context) => {
    requireUser(context);
    return dashboardCharts();
  },
  'GET /dashboard/alerts': (context) => {
    requireUser(context);
    return dashboardAlerts();
  },
  'GET /dashboard/activity': (context) => {
    requireUser(context);
    return db().activityLogs.slice(-25).reverse();
  },

  // ---------------------------------------------------------------- leads
  'GET /leads': (context) => {
    requireUser(context);
    const data = db();
    const page = listRows(data.leads as unknown as Record<string, unknown>[], context.query, {
      searchFields: ['name', 'phone', 'email', 'assignedTo', 'notes'],
      dateField: 'createdAt',
      sortable: ['createdAt', 'name', 'budget', 'followUpDate', 'status'],
      defaultSort: 'createdAt',
      filter: (row) => {
        const lead = row as unknown as { status: string; source: string; projectId: number | null };
        if (context.query.status && lead.status !== context.query.status) return false;
        if (context.query.source && lead.source !== context.query.source) return false;
        const projectId = num(context.query.projectId);
        if (projectId && lead.projectId !== projectId) return false;
        return true;
      },
    });
    return {
      ...page,
      rows: page.rows.map((row) => {
        const lead = row as unknown as { interestedPropertyId: number | null; projectId: number | null };
        return {
          ...row,
          interestedProperty: data.properties.find((item) => item.id === lead.interestedPropertyId) ?? null,
          project: data.projects.find((item) => item.id === lead.projectId) ?? null,
        };
      }),
    };
  },

  'POST /leads': (context) => {
    const user = requireUser(context);
    const input = leadSchema.parse(context.body);
    const data = db();
    const row = {
      id: nextId(data.leads),
      ...input,
      email: input.email ?? null,
      assignedTo: input.assignedTo ?? null,
      notes: input.notes ?? null,
      followUpDate: input.followUpDate ?? null,
      interestedPropertyId: input.interestedPropertyId ?? null,
      projectId: input.projectId ?? null,
      convertedClientId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    data.leads.push(row);
    data.leadActivities.push({
      id: nextId(data.leadActivities),
      leadId: row.id,
      type: 'NOTE',
      detail: `Lead created by ${user.username}.`,
      happenedOn: new Date(),
      createdAt: new Date(),
    });
    save('leads', 'leadActivities');
    logActivity(user.username, 'CREATE', 'Lead', row.id);
    return row;
  },

  'PUT /leads/:id': (context) => {
    const user = requireUser(context);
    const data = db();
    const lead = byId(data.leads, Number(context.params.id));
    if (!lead) throw notFound('Lead');
    const input = leadSchema.parse(context.body);
    Object.assign(lead, {
      ...input,
      email: input.email ?? null,
      assignedTo: input.assignedTo ?? null,
      notes: input.notes ?? null,
      followUpDate: input.followUpDate ?? null,
      interestedPropertyId: input.interestedPropertyId ?? null,
      projectId: input.projectId ?? null,
      updatedAt: new Date(),
    });
    save('leads');
    logActivity(user.username, 'UPDATE', 'Lead', lead.id);
    return lead;
  },

  'DELETE /leads/:id': (context) => {
    const user = requireUser(context);
    const data = db();
    const id = Number(context.params.id);
    if (!byId(data.leads, id)) throw notFound('Lead');
    data.leads = data.leads.filter((row) => row.id !== id);
    data.leadActivities = data.leadActivities.filter((row) => row.leadId !== id);
    save('leads', 'leadActivities');
    logActivity(user.username, 'DELETE', 'Lead', id);
    return { ok: true };
  },

  'PATCH /leads/:id/status': (context) => {
    const user = requireUser(context);
    const data = db();
    const lead = byId(data.leads, Number(context.params.id));
    if (!lead) throw notFound('Lead');
    const status = leadSchema.shape.status.parse((context.body as { status?: unknown })?.status);
    const previous = lead.status;
    lead.status = status;
    lead.updatedAt = new Date();
    data.leadActivities.push({
      id: nextId(data.leadActivities),
      leadId: lead.id,
      type: 'STATUS_CHANGE',
      detail: `Status changed from ${previous} to ${status}.`,
      happenedOn: new Date(),
      createdAt: new Date(),
    });
    save('leads', 'leadActivities');
    logActivity(user.username, 'STATUS', 'Lead', lead.id, status);
    return lead;
  },

  'GET /leads/:id/activities': (context) => {
    requireUser(context);
    const leadId = Number(context.params.id);
    return db()
      .leadActivities.filter((row) => row.leadId === leadId)
      .sort((a, b) => b.happenedOn.getTime() - a.happenedOn.getTime());
  },

  'POST /leads/:id/activities': (context) => {
    requireUser(context);
    const data = db();
    const leadId = Number(context.params.id);
    if (!byId(data.leads, leadId)) throw notFound('Lead');
    const input = leadActivitySchema.parse(context.body);
    const row = { id: nextId(data.leadActivities), leadId, ...input, createdAt: new Date() };
    data.leadActivities.push(row);
    save('leadActivities');
    return row;
  },

  'POST /leads/:id/convert': (context) => {
    const user = requireUser(context);
    const data = db();
    const lead = byId(data.leads, Number(context.params.id));
    if (!lead) throw notFound('Lead');
    const input = convertLeadSchema.parse(context.body ?? {});

    const client = {
      id: nextId(data.clients),
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      address: input.address ?? null,
      panNo: input.panNo ?? null,
      aadhaarNo: null,
      notes: lead.notes,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    data.clients.push(client);
    data.interactions.push({
      id: nextId(data.interactions),
      clientId: client.id,
      type: 'NOTE',
      detail: `Converted from lead #${lead.id} (${lead.source.toLowerCase()}).`,
      happenedOn: new Date(),
      createdAt: new Date(),
    });

    const propertyId = input.propertyId ?? lead.interestedPropertyId ?? null;
    if (input.createBooking && propertyId) {
      const property = byId(data.properties, propertyId);
      if (!property) throw notFound('Property');
      data.bookings.push({
        id: nextId(data.bookings),
        clientId: client.id,
        propertyId,
        projectId: property.projectId,
        bookingDate: new Date(),
        agreementValue: input.agreementValue || property.price,
        bookingAmount: input.bookingAmount,
        status: 'ACTIVE',
        agreementNo: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      property.status = 'SOLD';
    }

    lead.status = 'WON';
    lead.convertedClientId = client.id;
    lead.updatedAt = new Date();
    data.leadActivities.push({
      id: nextId(data.leadActivities),
      leadId: lead.id,
      type: 'STATUS_CHANGE',
      detail: `Converted to client #${client.id}.`,
      happenedOn: new Date(),
      createdAt: new Date(),
    });

    save('clients', 'interactions', 'bookings', 'properties', 'leads', 'leadActivities');
    logActivity(user.username, 'CONVERT', 'Lead', lead.id, `Client #${client.id}`);
    return client;
  },

  // ---------------------------------------------------------------- clients
  'GET /clients': (context) => {
    requireUser(context);
    const data = db();
    const page = listRows(data.clients as unknown as Record<string, unknown>[], context.query, {
      searchFields: ['name', 'phone', 'email', 'panNo'],
      dateField: 'createdAt',
      sortable: ['createdAt', 'name'],
      defaultSort: 'createdAt',
    });
    return {
      ...page,
      rows: page.rows.map((row) => {
        const client = row as unknown as { id: number };
        return {
          ...row,
          bookings: data.bookings
            .filter((booking) => booking.clientId === client.id)
            .map((booking) => ({
              ...booking,
              property: data.properties.find((property) => property.id === booking.propertyId) ?? null,
            })),
          payments: data.payments.filter((payment) => payment.clientId === client.id),
        };
      }),
    };
  },

  'POST /clients': (context) => {
    const user = requireUser(context);
    const input = clientSchema.parse(context.body);
    const data = db();
    const row = {
      id: nextId(data.clients),
      ...input,
      email: input.email ?? null,
      address: input.address ?? null,
      panNo: input.panNo ?? null,
      aadhaarNo: input.aadhaarNo ?? null,
      notes: input.notes ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    data.clients.push(row);
    save('clients');
    logActivity(user.username, 'CREATE', 'Client', row.id);
    return row;
  },

  'PUT /clients/:id': (context) => {
    const user = requireUser(context);
    const data = db();
    const client = byId(data.clients, Number(context.params.id));
    if (!client) throw notFound('Client');
    const input = clientSchema.parse(context.body);
    Object.assign(client, {
      ...input,
      email: input.email ?? null,
      address: input.address ?? null,
      panNo: input.panNo ?? null,
      aadhaarNo: input.aadhaarNo ?? null,
      notes: input.notes ?? null,
      updatedAt: new Date(),
    });
    save('clients');
    logActivity(user.username, 'UPDATE', 'Client', client.id);
    return client;
  },

  'DELETE /clients/:id': (context) => {
    const user = requireUser(context);
    const data = db();
    const id = Number(context.params.id);
    if (!byId(data.clients, id)) throw notFound('Client');
    const bookings = data.bookings.filter((row) => row.clientId === id);
    for (const booking of bookings) {
      const property = byId(data.properties, booking.propertyId);
      if (property) property.status = 'AVAILABLE';
    }
    data.clients = data.clients.filter((row) => row.id !== id);
    data.bookings = data.bookings.filter((row) => row.clientId !== id);
    data.payments = data.payments.filter((row) => row.clientId !== id);
    data.interactions = data.interactions.filter((row) => row.clientId !== id);
    data.documents = data.documents.filter((row) => row.clientId !== id);
    save('clients', 'bookings', 'payments', 'interactions', 'documents', 'properties');
    logActivity(user.username, 'DELETE', 'Client', id);
    return { ok: true };
  },

  'GET /clients/:id/timeline': (context) => {
    requireUser(context);
    const data = db();
    const clientId = Number(context.params.id);
    const client = byId(data.clients, clientId);
    if (!client) throw notFound('Client');

    const bookings = data.bookings
      .filter((row) => row.clientId === clientId)
      .map((booking) => ({
        ...booking,
        property: data.properties.find((row) => row.id === booking.propertyId) ?? null,
        project: data.projects.find((row) => row.id === booking.projectId) ?? null,
      }))
      .sort((a, b) => b.bookingDate.getTime() - a.bookingDate.getTime());
    const payments = data.payments
      .filter((row) => row.clientId === clientId)
      .sort((a, b) => b.paidOn.getTime() - a.paidOn.getTime());
    const documents = data.documents.filter((row) => row.clientId === clientId);
    const interactions = data.interactions
      .filter((row) => row.clientId === clientId)
      .sort((a, b) => b.happenedOn.getTime() - a.happenedOn.getTime());

    const timeline = [
      ...interactions.map((row) => ({
        at: row.happenedOn.toISOString(),
        type: row.type,
        title: row.type === 'NOTE' ? 'Note added' : `${row.type} logged`,
        detail: row.detail,
      })),
      ...payments.map((row) => ({
        at: row.paidOn.toISOString(),
        type: 'PAYMENT',
        title: `Payment received (${row.mode})`,
        detail: `${round(row.amount, 2)}${row.reference ? ` • ${row.reference}` : ''}`,
      })),
      ...bookings.map((row) => ({
        at: row.bookingDate.toISOString(),
        type: 'BOOKING',
        title: `Booked ${row.property?.tower ?? ''}-${row.property?.unit ?? ''}`,
        detail: `${row.project?.name ?? ''} • agreement value ${round(row.agreementValue, 2)}`,
      })),
      ...documents.map((row) => ({
        at: row.uploadedAt.toISOString(),
        type: 'DOCUMENT',
        title: `Document: ${row.title}`,
        detail: row.category,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    const agreementValue = bookings
      .filter((booking) => booking.status !== 'CANCELLED')
      .reduce((acc, booking) => acc + booking.agreementValue, 0);
    const collected = payments.reduce((acc, payment) => acc + payment.amount, 0);

    return {
      client,
      bookings,
      payments,
      documents,
      timeline,
      totals: {
        agreementValue: round(agreementValue, 2),
        collected: round(collected, 2),
        outstanding: round(agreementValue - collected, 2),
      },
    };
  },

  'POST /clients/:id/interactions': (context) => {
    requireUser(context);
    const data = db();
    const clientId = Number(context.params.id);
    if (!byId(data.clients, clientId)) throw notFound('Client');
    const input = interactionSchema.parse({ ...(context.body as object), clientId });
    const row = { id: nextId(data.interactions), ...input, createdAt: new Date() };
    data.interactions.push(row);
    save('interactions');
    return row;
  },

  // ---------------------------------------------------------------- bookings & payments
  'GET /bookings': (context) => {
    requireUser(context);
    const data = db();
    const clientId = num(context.query.clientId);
    return listRows(data.bookings as unknown as Record<string, unknown>[], context.query, {
      searchFields: ['agreementNo', 'notes'],
      dateField: 'bookingDate',
      sortable: ['bookingDate', 'agreementValue', 'createdAt'],
      defaultSort: 'bookingDate',
      filter: (row) => (clientId ? (row as unknown as { clientId: number }).clientId === clientId : true),
    });
  },

  'POST /bookings': (context) => {
    const user = requireUser(context);
    const input = bookingSchema.parse(context.body);
    const data = db();
    const property = byId(data.properties, input.propertyId);
    if (!property) throw notFound('Property');
    const row = {
      id: nextId(data.bookings),
      ...input,
      projectId: input.projectId ?? property.projectId,
      agreementNo: input.agreementNo ?? null,
      notes: input.notes ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    data.bookings.push(row);
    property.status = row.status === 'CANCELLED' ? 'AVAILABLE' : 'SOLD';
    save('bookings', 'properties');
    logActivity(user.username, 'CREATE', 'Booking', row.id);
    return row;
  },

  'GET /payments': (context) => {
    requireUser(context);
    const clientId = num(context.query.clientId);
    return listRows(db().payments as unknown as Record<string, unknown>[], context.query, {
      searchFields: ['reference', 'notes'],
      dateField: 'paidOn',
      sortable: ['paidOn', 'amount', 'createdAt'],
      defaultSort: 'paidOn',
      filter: (row) => (clientId ? (row as unknown as { clientId: number }).clientId === clientId : true),
    });
  },

  'POST /payments': (context) => {
    const user = requireUser(context);
    const input = paymentSchema.parse(context.body);
    const data = db();
    if (!byId(data.clients, input.clientId)) throw notFound('Client');
    const row = {
      id: nextId(data.payments),
      ...input,
      bookingId: input.bookingId ?? null,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      createdAt: new Date(),
    };
    data.payments.push(row);
    save('payments');
    logActivity(user.username, 'CREATE', 'Payment', row.id);
    return row;
  },
};

// ---------------------------------------------------------------- projects
Object.assign(handlers, {
  'GET /projects/options': (context: Context) => {
    requireUser(context);
    return db()
      .projects.map((project) => ({ id: project.id, name: project.name, code: project.code, status: project.status }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  'GET /projects': (context: Context) => {
    requireUser(context);
    const data = db();
    const page = listRows(data.projects as unknown as Record<string, unknown>[], context.query, {
      searchFields: ['name', 'code', 'location', 'contractor', 'engineer'],
      dateField: 'startDate',
      sortable: ['name', 'code', 'startDate', 'expectedEndDate', 'budget', 'createdAt'],
      defaultSort: 'startDate',
      filter: (row) =>
        context.query.status ? (row as unknown as { status: string }).status === context.query.status : true,
    });
    return {
      ...page,
      rows: page.rows.map((row) => {
        const project = row as unknown as { id: number };
        return {
          ...row,
          stages: data.projectStages
            .filter((stage) => stage.projectId === project.id)
            .sort((a, b) => a.sortOrder - b.sortOrder),
          _count: {
            properties: data.properties.filter((item) => item.projectId === project.id).length,
            dprs: data.dprs.filter((item) => item.projectId === project.id).length,
            milestones: data.milestones.filter((item) => item.projectId === project.id).length,
          },
        };
      }),
    };
  },

  'POST /projects': (context: Context) => {
    const user = requireUser(context);
    const input = projectSchema.parse(context.body);
    const data = db();
    if (data.projects.some((project) => project.code.toLowerCase() === input.code.toLowerCase())) {
      throw new LocalApiError(409, 'That project code is already in use.');
    }
    const row = {
      id: nextId(data.projects),
      ...input,
      actualEndDate: input.actualEndDate ?? null,
      contractor: input.contractor ?? null,
      engineer: input.engineer ?? null,
      description: input.description ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    data.projects.push(row);
    DEFAULT_STAGES.forEach((stage, index) => {
      data.projectStages.push({
        id: nextId(data.projectStages),
        projectId: row.id,
        name: stage.name,
        weight: stage.weight,
        progress: 0,
        sortOrder: index,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    save('projects', 'projectStages');
    logActivity(user.username, 'CREATE', 'Project', row.id);
    return row;
  },

  'PUT /projects/:id': (context: Context) => {
    const user = requireUser(context);
    const data = db();
    const project = byId(data.projects, Number(context.params.id));
    if (!project) throw notFound('Project');
    const input = projectSchema.parse(context.body);
    if (data.projects.some((row) => row.id !== project.id && row.code.toLowerCase() === input.code.toLowerCase())) {
      throw new LocalApiError(409, 'That project code is already in use.');
    }
    Object.assign(project, {
      ...input,
      actualEndDate: input.actualEndDate ?? null,
      contractor: input.contractor ?? null,
      engineer: input.engineer ?? null,
      description: input.description ?? null,
      updatedAt: new Date(),
    });
    save('projects');
    logActivity(user.username, 'UPDATE', 'Project', project.id);
    return project;
  },

  'DELETE /projects/:id': (context: Context) => {
    const user = requireUser(context);
    const data = db();
    const id = Number(context.params.id);
    if (!byId(data.projects, id)) throw notFound('Project');
    const stageIds = data.projectStages.filter((stage) => stage.projectId === id).map((stage) => stage.id);
    const propertyIds = data.properties.filter((row) => row.projectId === id).map((row) => row.id);
    const dprIds = data.dprs.filter((row) => row.projectId === id).map((row) => row.id);

    data.projects = data.projects.filter((row) => row.id !== id);
    data.projectStages = data.projectStages.filter((row) => row.projectId !== id);
    data.stageProgressLogs = data.stageProgressLogs.filter((row) => !stageIds.includes(row.stageId));
    data.milestones = data.milestones.filter((row) => row.projectId !== id);
    data.properties = data.properties.filter((row) => row.projectId !== id);
    data.bookings = data.bookings.filter((row) => !propertyIds.includes(row.propertyId));
    data.materialUsages = data.materialUsages.filter((row) => row.projectId !== id);
    data.purchases = data.purchases.map((row) => (row.projectId === id ? { ...row, projectId: null } : row));
    data.attendances = data.attendances.filter((row) => row.projectId !== id);
    data.workers = data.workers.map((row) => (row.projectId === id ? { ...row, projectId: null } : row));
    data.dprs = data.dprs.filter((row) => row.projectId !== id);
    data.dprMaterials = data.dprMaterials.filter((row) => !dprIds.includes(row.dprId));
    data.dprPhotos = data.dprPhotos.filter((row) => !dprIds.includes(row.dprId));
    data.forecastSnapshots = data.forecastSnapshots.filter((row) => row.projectId !== id);

    save(
      'projects',
      'projectStages',
      'stageProgressLogs',
      'milestones',
      'properties',
      'bookings',
      'materialUsages',
      'purchases',
      'attendances',
      'workers',
      'dprs',
      'dprMaterials',
      'dprPhotos',
      'forecastSnapshots',
    );
    logActivity(user.username, 'DELETE', 'Project', id);
    return { ok: true };
  },

  'GET /projects/:id/overview': (context: Context) => {
    requireUser(context);
    const data = db();
    const projectId = Number(context.params.id);
    const project = byId(data.projects, projectId);
    if (!project) throw notFound('Project');

    const stages = data.projectStages
      .filter((stage) => stage.projectId === projectId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const totalWeight = stages.reduce((acc, stage) => acc + (stage.weight > 0 ? stage.weight : 1), 0) || 1;
    const progress = round(
      stages.reduce((acc, stage) => acc + stage.progress * (stage.weight > 0 ? stage.weight : 1), 0) / totalWeight,
      1,
    );

    const properties: Record<string, number> = {};
    for (const property of data.properties.filter((row) => row.projectId === projectId)) {
      properties[property.status] = (properties[property.status] ?? 0) + 1;
    }

    return {
      project: {
        ...project,
        stages,
        milestones: data.milestones
          .filter((row) => row.projectId === projectId)
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()),
      },
      progress,
      properties,
      materialValue: round(
        data.materialUsages
          .filter((row) => row.projectId === projectId)
          .reduce((acc, row) => acc + row.quantity * (data.materials.find((m) => m.id === row.materialId)?.rate ?? 0), 0),
        2,
      ),
      attendanceEntries: data.attendances.filter((row) => row.projectId === projectId).length,
      dprCount: data.dprs.filter((row) => row.projectId === projectId).length,
    };
  },

  'GET /projects/:id/stages': (context: Context) => {
    requireUser(context);
    const data = db();
    const projectId = Number(context.params.id);
    return data.projectStages
      .filter((stage) => stage.projectId === projectId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((stage) => ({
        ...stage,
        progressLogs: data.stageProgressLogs
          .filter((log) => log.stageId === stage.id)
          .sort((a, b) => b.recordedOn.getTime() - a.recordedOn.getTime())
          .slice(0, 20),
      }));
  },

  'POST /projects/stages/:stageId/progress': (context: Context) => {
    const user = requireUser(context);
    const data = db();
    const stage = byId(data.projectStages, Number(context.params.stageId));
    if (!stage) throw notFound('Stage');
    const input = stageProgressSchema.parse(context.body);

    stage.progress = input.progress;
    stage.updatedAt = new Date();
    data.stageProgressLogs.push({
      id: nextId(data.stageProgressLogs),
      stageId: stage.id,
      progress: input.progress,
      recordedOn: input.recordedOn,
      note: input.note ?? null,
      createdAt: new Date(),
    });
    save('projectStages', 'stageProgressLogs');
    logActivity(user.username, 'PROGRESS', 'ProjectStage', stage.id, `${input.progress}%`);
    return stage;
  },

  'POST /milestones': (context: Context) => {
    const user = requireUser(context);
    const input = milestoneSchema.parse(context.body);
    const data = db();
    if (!byId(data.projects, input.projectId)) throw notFound('Project');
    const row = {
      id: nextId(data.milestones),
      ...input,
      completedOn: input.completedOn ?? null,
      notes: input.notes ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    data.milestones.push(row);
    save('milestones');
    logActivity(user.username, 'CREATE', 'Milestone', row.id);
    return row;
  },

  // ---------------------------------------------------------------- properties
  'GET /properties': (context: Context) => {
    requireUser(context);
    const data = db();
    const projectId = num(context.query.projectId);
    const page = listRows(data.properties as unknown as Record<string, unknown>[], context.query, {
      searchFields: ['tower', 'unit', 'unitType', 'notes'],
      sortable: ['tower', 'floor', 'unit', 'price', 'sizeSqft', 'status', 'createdAt'],
      defaultSort: 'tower',
      filter: (row) => {
        const property = row as unknown as { projectId: number; status: string };
        if (projectId && property.projectId !== projectId) return false;
        if (context.query.status && property.status !== context.query.status) return false;
        return true;
      },
    });
    return {
      ...page,
      rows: page.rows.map((row) => {
        const property = row as unknown as { id: number; projectId: number };
        return {
          ...row,
          project: data.projects.find((item) => item.id === property.projectId) ?? null,
          bookings: data.bookings
            .filter((booking) => booking.propertyId === property.id && booking.status === 'ACTIVE')
            .map((booking) => ({
              id: booking.id,
              client: data.clients.find((client) => client.id === booking.clientId) ?? null,
            })),
        };
      }),
    };
  },

  'GET /properties/summary': (context: Context) => {
    requireUser(context);
    const data = db();
    const projectId = num(context.query.projectId);
    const rows = data.properties.filter((row) => (projectId ? row.projectId === projectId : true));
    const byStatus = new Map<string, { status: string; count: number; value: number }>();
    for (const row of rows) {
      const entry = byStatus.get(row.status) ?? { status: row.status, count: 0, value: 0 };
      entry.count += 1;
      entry.value += row.price;
      byStatus.set(row.status, entry);
    }
    return {
      byStatus: Array.from(byStatus.values()),
      total: rows.length,
      totalValue: rows.reduce((acc, row) => acc + row.price, 0),
      totalArea: rows.reduce((acc, row) => acc + row.sizeSqft, 0),
    };
  },

  'GET /properties/map': (context: Context) => {
    requireUser(context);
    const data = db();
    const projectId = num(context.query.projectId);
    const properties = data.properties.filter((row) => (projectId ? row.projectId === projectId : true));

    const towers = new Map<string, Map<number, typeof properties>>();
    for (const property of properties) {
      const floors = towers.get(property.tower) ?? new Map<number, typeof properties>();
      const units = floors.get(property.floor) ?? [];
      units.push(property);
      floors.set(property.floor, units);
      towers.set(property.tower, floors);
    }

    return Array.from(towers.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([tower, floors]) => ({
        tower,
        floors: Array.from(floors.entries())
          .sort((a, b) => b[0] - a[0])
          .map(([floor, units]) => ({
            floor,
            units: units
              .slice()
              .sort((a, b) => a.unit.localeCompare(b.unit))
              .map((unit) => {
                const booking = data.bookings.find((row) => row.propertyId === unit.id && row.status === 'ACTIVE');
                return {
                  id: unit.id,
                  unit: unit.unit,
                  unitType: unit.unitType,
                  sizeSqft: unit.sizeSqft,
                  price: unit.price,
                  facing: unit.facing,
                  status: unit.status,
                  client: booking ? (data.clients.find((row) => row.id === booking.clientId)?.name ?? null) : null,
                };
              }),
          })),
      }));
  },

  'POST /properties': (context: Context) => {
    const user = requireUser(context);
    const input = propertySchema.parse(context.body);
    const data = db();
    if (
      data.properties.some(
        (row) => row.projectId === input.projectId && row.tower === input.tower && row.unit === input.unit,
      )
    ) {
      throw new LocalApiError(409, 'That tower and unit already exists in this project.');
    }
    const row = {
      id: nextId(data.properties),
      ...input,
      notes: input.notes ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    data.properties.push(row);
    save('properties');
    logActivity(user.username, 'CREATE', 'Property', row.id);
    return row;
  },

  'PUT /properties/:id': (context: Context) => {
    const user = requireUser(context);
    const data = db();
    const property = byId(data.properties, Number(context.params.id));
    if (!property) throw notFound('Property');
    const input = propertySchema.parse(context.body);
    Object.assign(property, { ...input, notes: input.notes ?? null, updatedAt: new Date() });
    save('properties');
    logActivity(user.username, 'UPDATE', 'Property', property.id);
    return property;
  },

  'DELETE /properties/:id': (context: Context) => {
    const user = requireUser(context);
    const data = db();
    const id = Number(context.params.id);
    if (!byId(data.properties, id)) throw notFound('Property');
    data.properties = data.properties.filter((row) => row.id !== id);
    data.bookings = data.bookings.filter((row) => row.propertyId !== id);
    save('properties', 'bookings');
    logActivity(user.username, 'DELETE', 'Property', id);
    return { ok: true };
  },

  'POST /properties/import': (context: Context) => {
    const user = requireUser(context);
    const { rows } = propertyImportSchema.parse(context.body);
    const data = db();
    let created = 0;
    let updated = 0;

    for (const row of rows) {
      const existing = data.properties.find(
        (item) => item.projectId === row.projectId && item.tower === row.tower && item.unit === row.unit,
      );
      if (existing) {
        Object.assign(existing, { ...row, notes: row.notes ?? existing.notes, updatedAt: new Date() });
        updated += 1;
      } else {
        data.properties.push({
          id: nextId(data.properties),
          ...row,
          notes: row.notes ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        created += 1;
      }
    }

    save('properties');
    logActivity(user.username, 'IMPORT', 'Property', undefined, `${created} created, ${updated} updated`);
    return { created, updated };
  },
});

// ---------------------------------------------------------------- inventory
Object.assign(handlers, {
  'GET /materials/options': (context: Context) => {
    requireUser(context);
    return db()
      .materials.filter((material) => material.active)
      .map((material) => ({
        id: material.id,
        name: material.name,
        unit: material.unit,
        rate: material.rate,
        category: material.category,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  'GET /materials/stock': (context: Context) => {
    requireUser(context);
    const rows = stockRows({
      q: context.query.q ? String(context.query.q) : undefined,
      category: context.query.category ? String(context.query.category) : undefined,
    });
    return {
      rows,
      totals: {
        materials: rows.length,
        stockValue: round(
          rows.reduce((acc, row) => acc + row.stockValue, 0),
          2,
        ),
        lowStock: rows.filter((row) => row.low).length,
      },
    };
  },

  'GET /materials': (context: Context) => {
    requireUser(context);
    return listRows(db().materials as unknown as Record<string, unknown>[], context.query, {
      searchFields: ['name', 'category', 'unit'],
      sortable: ['name', 'category', 'rate', 'createdAt'],
      defaultSort: 'name',
      filter: (row) =>
        context.query.category ? (row as unknown as { category: string }).category === context.query.category : true,
    });
  },

  'POST /materials': (context: Context) => {
    const user = requireUser(context);
    const input = materialSchema.parse(context.body);
    const data = db();
    if (data.materials.some((row) => row.name.toLowerCase() === input.name.toLowerCase())) {
      throw new LocalApiError(409, 'A material with that name already exists.');
    }
    const row = { id: nextId(data.materials), ...input, createdAt: new Date(), updatedAt: new Date() };
    data.materials.push(row);
    save('materials');
    logActivity(user.username, 'CREATE', 'Material', row.id);
    return row;
  },

  'PUT /materials/:id': (context: Context) => {
    const user = requireUser(context);
    const data = db();
    const material = byId(data.materials, Number(context.params.id));
    if (!material) throw notFound('Material');
    Object.assign(material, materialSchema.parse(context.body), { updatedAt: new Date() });
    save('materials');
    logActivity(user.username, 'UPDATE', 'Material', material.id);
    return material;
  },

  'GET /materials/:id/ledger': (context: Context) => {
    requireUser(context);
    const data = db();
    const materialId = Number(context.params.id);
    const entries = [
      ...data.purchases
        .filter((row) => row.materialId === materialId)
        .map((row) => ({
          id: `P${row.id}`,
          at: row.purchasedOn.toISOString(),
          type: 'PURCHASE' as const,
          quantity: row.quantity,
          detail: `${row.supplier ?? 'Purchase'}${row.invoiceNo ? ` • ${row.invoiceNo}` : ''}`,
          project: data.projects.find((item) => item.id === row.projectId)?.name ?? '',
        })),
      ...data.materialUsages
        .filter((row) => row.materialId === materialId)
        .map((row) => ({
          id: `U${row.id}`,
          at: row.usedOn.toISOString(),
          type: 'ISSUE' as const,
          quantity: -row.quantity,
          detail: row.issuedTo ? `Issued to ${row.issuedTo}` : 'Issued to site',
          project: data.projects.find((item) => item.id === row.projectId)?.name ?? '',
        })),
      ...data.stockAdjustments
        .filter((row) => row.materialId === materialId)
        .map((row) => ({
          id: `A${row.id}`,
          at: row.adjustedOn.toISOString(),
          type: 'ADJUSTMENT' as const,
          quantity: row.quantity,
          detail: row.reason,
          project: '',
        })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    return { stock: stockRows().find((row) => row.id === materialId) ?? null, entries };
  },

  'GET /purchases': (context: Context) => {
    requireUser(context);
    const data = db();
    const materialId = num(context.query.materialId);
    const projectId = num(context.query.projectId);
    const page = listRows(data.purchases as unknown as Record<string, unknown>[], context.query, {
      searchFields: ['supplier', 'invoiceNo', 'notes'],
      dateField: 'purchasedOn',
      sortable: ['purchasedOn', 'amount', 'quantity', 'createdAt'],
      defaultSort: 'purchasedOn',
      filter: (row) => {
        const purchase = row as unknown as { materialId: number; projectId: number | null };
        if (materialId && purchase.materialId !== materialId) return false;
        if (projectId && purchase.projectId !== projectId) return false;
        return true;
      },
    });
    return {
      ...page,
      rows: page.rows.map((row) => {
        const purchase = row as unknown as { materialId: number; projectId: number | null };
        return {
          ...row,
          material: data.materials.find((item) => item.id === purchase.materialId) ?? null,
          project: data.projects.find((item) => item.id === purchase.projectId) ?? null,
        };
      }),
    };
  },

  'POST /purchases': (context: Context) => {
    const user = requireUser(context);
    const input = purchaseSchema.parse(context.body);
    const data = db();
    if (!byId(data.materials, input.materialId)) throw notFound('Material');
    const row = {
      id: nextId(data.purchases),
      ...input,
      projectId: input.projectId ?? null,
      supplier: input.supplier ?? null,
      invoiceNo: input.invoiceNo ?? null,
      notes: input.notes ?? null,
      amount: round(input.quantity * input.rate, 2),
      createdAt: new Date(),
    };
    data.purchases.push(row);
    save('purchases');
    logActivity(user.username, 'CREATE', 'Purchase', row.id);
    return row;
  },

  'GET /usage': (context: Context) => {
    requireUser(context);
    const data = db();
    const materialId = num(context.query.materialId);
    const projectId = num(context.query.projectId);
    const page = listRows(data.materialUsages as unknown as Record<string, unknown>[], context.query, {
      searchFields: ['issuedTo', 'notes'],
      dateField: 'usedOn',
      sortable: ['usedOn', 'quantity', 'createdAt'],
      defaultSort: 'usedOn',
      filter: (row) => {
        const usage = row as unknown as { materialId: number; projectId: number };
        if (materialId && usage.materialId !== materialId) return false;
        if (projectId && usage.projectId !== projectId) return false;
        return true;
      },
    });
    return {
      ...page,
      rows: page.rows.map((row) => {
        const usage = row as unknown as { materialId: number; projectId: number };
        return {
          ...row,
          material: data.materials.find((item) => item.id === usage.materialId) ?? null,
          project: data.projects.find((item) => item.id === usage.projectId) ?? null,
        };
      }),
    };
  },

  'POST /usage': (context: Context) => {
    const user = requireUser(context);
    const input = materialUsageSchema.parse(context.body);
    const data = db();
    if (!byId(data.materials, input.materialId)) throw notFound('Material');
    if (!byId(data.projects, input.projectId)) throw notFound('Project');
    const row = {
      id: nextId(data.materialUsages),
      ...input,
      issuedTo: input.issuedTo ?? null,
      notes: input.notes ?? null,
      createdAt: new Date(),
    };
    data.materialUsages.push(row);
    save('materialUsages');
    logActivity(user.username, 'CREATE', 'MaterialUsage', row.id);
    return row;
  },

  'GET /usage/summary/consumption': (context: Context) => {
    requireUser(context);
    const data = db();
    const to = context.query.to ? new Date(String(context.query.to)) : new Date();
    const from = context.query.from
      ? new Date(String(context.query.from))
      : new Date(to.getTime() - 29 * 86_400_000);
    const projectId = num(context.query.projectId);

    const usages = data.materialUsages.filter(
      (row) =>
        row.usedOn >= startOfDay(from) &&
        row.usedOn <= endOfDay(to) &&
        (projectId ? row.projectId === projectId : true),
    );

    const byMaterial = new Map<string, { name: string; unit: string; quantity: number; value: number }>();
    const byDay = new Map<string, number>();
    for (const usage of usages) {
      const material = data.materials.find((row) => row.id === usage.materialId);
      const name = material?.name ?? `Material ${usage.materialId}`;
      const entry = byMaterial.get(name) ?? { name, unit: material?.unit ?? '', quantity: 0, value: 0 };
      const value = usage.quantity * (material?.rate ?? 0);
      entry.quantity += usage.quantity;
      entry.value += value;
      byMaterial.set(name, entry);
      const day = dayKey(usage.usedOn);
      byDay.set(day, (byDay.get(day) ?? 0) + value);
    }

    const stockByName = new Map(stockRows().map((row) => [row.name, row.inStock]));

    return {
      from: startOfDay(from).toISOString(),
      to: endOfDay(to).toISOString(),
      byMaterial: Array.from(byMaterial.values())
        .map((entry) => ({
          ...entry,
          quantity: round(entry.quantity, 2),
          value: round(entry.value, 2),
          remaining: stockByName.get(entry.name) ?? 0,
        }))
        .sort((a, b) => b.value - a.value),
      byDay: Array.from(byDay.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, value]) => ({ date, value: round(value, 2) })),
      totalValue: round(
        Array.from(byMaterial.values()).reduce((acc, entry) => acc + entry.value, 0),
        2,
      ),
    };
  },

  'GET /adjustments': (context: Context) => {
    requireUser(context);
    const data = db();
    const materialId = num(context.query.materialId);
    const page = listRows(data.stockAdjustments as unknown as Record<string, unknown>[], context.query, {
      searchFields: ['reason', 'notes'],
      dateField: 'adjustedOn',
      sortable: ['adjustedOn', 'quantity', 'createdAt'],
      defaultSort: 'adjustedOn',
      filter: (row) =>
        materialId ? (row as unknown as { materialId: number }).materialId === materialId : true,
    });
    return {
      ...page,
      rows: page.rows.map((row) => ({
        ...row,
        material:
          data.materials.find((item) => item.id === (row as unknown as { materialId: number }).materialId) ?? null,
      })),
    };
  },

  'POST /adjustments': (context: Context) => {
    const user = requireUser(context);
    const input = stockAdjustmentSchema.parse(context.body);
    const data = db();
    if (!byId(data.materials, input.materialId)) throw notFound('Material');
    const row = {
      id: nextId(data.stockAdjustments),
      ...input,
      notes: input.notes ?? null,
      createdAt: new Date(),
    };
    data.stockAdjustments.push(row);
    save('stockAdjustments');
    logActivity(user.username, 'CREATE', 'StockAdjustment', row.id);
    return row;
  },

  // ---------------------------------------------------------------- labour
  'GET /workers/options': (context: Context) => {
    requireUser(context);
    return db()
      .workers.filter((worker) => worker.active)
      .map((worker) => ({
        id: worker.id,
        name: worker.name,
        skill: worker.skill,
        dailyWage: worker.dailyWage,
        contractor: worker.contractor,
        projectId: worker.projectId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  'GET /workers': (context: Context) => {
    requireUser(context);
    const data = db();
    const projectId = num(context.query.projectId);
    const page = listRows(data.workers as unknown as Record<string, unknown>[], context.query, {
      searchFields: ['name', 'mobile', 'contractor', 'skill'],
      sortable: ['name', 'skill', 'dailyWage', 'joinedOn', 'createdAt'],
      defaultSort: 'name',
      filter: (row) => {
        const worker = row as unknown as { projectId: number | null; skill: string; active: boolean };
        if (projectId && worker.projectId !== projectId) return false;
        if (context.query.skill && worker.skill !== context.query.skill) return false;
        if (context.query.status === 'ACTIVE' && !worker.active) return false;
        if (context.query.status === 'INACTIVE' && worker.active) return false;
        return true;
      },
    });
    return {
      ...page,
      rows: page.rows.map((row) => ({
        ...row,
        project:
          data.projects.find((item) => item.id === (row as unknown as { projectId: number | null }).projectId) ?? null,
      })),
    };
  },

  'POST /workers': (context: Context) => {
    const user = requireUser(context);
    const input = workerSchema.parse(context.body);
    const data = db();
    const row = {
      id: nextId(data.workers),
      ...input,
      mobile: input.mobile ?? null,
      contractor: input.contractor ?? null,
      projectId: input.projectId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    data.workers.push(row);
    save('workers');
    logActivity(user.username, 'CREATE', 'Worker', row.id);
    return row;
  },

  'PUT /workers/:id': (context: Context) => {
    const user = requireUser(context);
    const data = db();
    const worker = byId(data.workers, Number(context.params.id));
    if (!worker) throw notFound('Worker');
    const input = workerSchema.parse(context.body);
    Object.assign(worker, {
      ...input,
      mobile: input.mobile ?? null,
      contractor: input.contractor ?? null,
      projectId: input.projectId ?? null,
      updatedAt: new Date(),
    });
    save('workers');
    logActivity(user.username, 'UPDATE', 'Worker', worker.id);
    return worker;
  },

  'DELETE /workers/:id': (context: Context) => {
    const user = requireUser(context);
    const data = db();
    const id = Number(context.params.id);
    if (!byId(data.workers, id)) throw notFound('Worker');
    data.workers = data.workers.filter((row) => row.id !== id);
    data.attendances = data.attendances.filter((row) => row.workerId !== id);
    save('workers', 'attendances');
    logActivity(user.username, 'DELETE', 'Worker', id);
    return { ok: true };
  },

  'GET /attendance/day': (context: Context) => {
    requireUser(context);
    const data = db();
    const date = context.query.date ? new Date(String(context.query.date)) : new Date();
    if (Number.isNaN(date.getTime())) throw badRequest('Enter a valid date.');
    const projectId = num(context.query.projectId);

    const marked = data.attendances.filter(
      (row) => row.markedOn >= startOfDay(date) && row.markedOn <= endOfDay(date),
    );

    return {
      date: startOfDay(date).toISOString(),
      rows: data.workers
        .filter((worker) => worker.active && (projectId ? worker.projectId === projectId : true))
        .sort((a, b) => (a.contractor ?? '').localeCompare(b.contractor ?? '') || a.name.localeCompare(b.name))
        .map((worker) => {
          const entry = marked.find((row) => row.workerId === worker.id);
          return {
            workerId: worker.id,
            name: worker.name,
            skill: worker.skill,
            contractor: worker.contractor,
            dailyWage: worker.dailyWage,
            projectId: worker.projectId,
            status: entry?.status ?? null,
            overtimeHours: entry?.overtimeHours ?? 0,
            notes: entry?.notes ?? '',
            attendanceId: entry?.id ?? null,
          };
        }),
    };
  },

  'POST /attendance/day': (context: Context) => {
    const user = requireUser(context);
    const input = attendanceDaySchema.parse(context.body);
    const data = db();
    const markedOn = startOfDay(input.markedOn);

    for (const entry of input.entries) {
      const existing = data.attendances.find(
        (row) => row.workerId === entry.workerId && startOfDay(row.markedOn).getTime() === markedOn.getTime(),
      );
      if (existing) {
        existing.status = entry.status;
        existing.overtimeHours = entry.overtimeHours;
        existing.notes = entry.notes ?? null;
        existing.projectId = input.projectId ?? null;
      } else {
        data.attendances.push({
          id: nextId(data.attendances),
          workerId: entry.workerId,
          projectId: input.projectId ?? null,
          markedOn,
          status: entry.status,
          overtimeHours: entry.overtimeHours,
          notes: entry.notes ?? null,
          createdAt: new Date(),
        } satisfies AttendanceRow);
      }
    }

    save('attendances');
    logActivity(
      user.username,
      'ATTENDANCE',
      'Attendance',
      undefined,
      `${input.entries.length} worker(s) for ${markedOn.toISOString().slice(0, 10)}`,
    );
    return { saved: input.entries.length, date: markedOn.toISOString() };
  },

  'GET /attendance/sheet': (context: Context) => {
    requireUser(context);
    const data = db();
    const match = /^(\d{4})-(\d{2})$/.exec(String(context.query.month ?? ''));
    const today = new Date();
    const year = match ? Number(match[1]) : today.getFullYear();
    const month = match ? Number(match[2]) - 1 : today.getMonth();
    const from = startOfDay(new Date(year, month, 1));
    const to = endOfDay(new Date(year, month + 1, 0));
    const daysInMonth = to.getDate();
    const projectId = num(context.query.projectId);

    const attendance = data.attendances.filter(
      (row) => row.markedOn >= from && row.markedOn <= to && (projectId ? row.projectId === projectId : true),
    );

    const rows = data.workers
      .filter((worker) => worker.active && (projectId ? worker.projectId === projectId : true))
      .sort((a, b) => (a.contractor ?? '').localeCompare(b.contractor ?? '') || a.name.localeCompare(b.name))
      .map((worker) => {
        const days = new Map<number, { status: string; overtimeHours: number }>();
        for (const row of attendance.filter((item) => item.workerId === worker.id)) {
          days.set(row.markedOn.getDate(), { status: row.status, overtimeHours: row.overtimeHours });
        }

        let labourDays = 0;
        let overtime = 0;
        let present = 0;
        let halfDay = 0;
        let absent = 0;
        const cells: (null | { status: string; overtimeHours: number })[] = [];
        for (let day = 1; day <= daysInMonth; day += 1) {
          const cell = days.get(day) ?? null;
          cells.push(cell);
          if (!cell) continue;
          labourDays += ATTENDANCE_WEIGHT[cell.status as AttendanceStatus] ?? 0;
          overtime += cell.overtimeHours;
          if (cell.status === 'PRESENT') present += 1;
          else if (cell.status === 'HALF_DAY') halfDay += 1;
          else absent += 1;
        }

        const basePay = labourDays * worker.dailyWage;
        const overtimePay = (worker.dailyWage / 8) * overtime;
        return {
          workerId: worker.id,
          name: worker.name,
          skill: worker.skill,
          contractor: worker.contractor ?? '',
          dailyWage: worker.dailyWage,
          cells,
          present,
          halfDay,
          absent,
          labourDays: round(labourDays, 2),
          overtimeHours: round(overtime, 2),
          basePay: round(basePay, 2),
          overtimePay: round(overtimePay, 2),
          payable: round(basePay + overtimePay, 2),
        };
      });

    return {
      month: `${year}-${String(month + 1).padStart(2, '0')}`,
      daysInMonth,
      rows,
      totals: {
        labourDays: round(
          rows.reduce((acc, row) => acc + row.labourDays, 0),
          2,
        ),
        payable: round(
          rows.reduce((acc, row) => acc + row.payable, 0),
          2,
        ),
        workers: rows.length,
      },
    };
  },

  'GET /attendance/consumption': (context: Context) => {
    requireUser(context);
    const data = db();
    const to = context.query.to ? endOfDay(new Date(String(context.query.to))) : endOfDay(new Date());
    const from = context.query.from
      ? startOfDay(new Date(String(context.query.from)))
      : startOfDay(new Date(to.getFullYear(), to.getMonth(), 1));
    const projectId = num(context.query.projectId);

    const rows = data.attendances.filter(
      (row) => row.markedOn >= from && row.markedOn <= to && (projectId ? row.projectId === projectId : true),
    );

    let labourDays = 0;
    let cost = 0;
    const bySkill = new Map<string, { skill: string; labourDays: number; cost: number }>();
    const byDay = new Map<string, number>();
    const workers = new Set<number>();

    for (const row of rows) {
      const worker = data.workers.find((item) => item.id === row.workerId);
      const weight = ATTENDANCE_WEIGHT[row.status as AttendanceStatus] ?? 0;
      const wage = worker?.dailyWage ?? 0;
      const pay = wage * weight + (wage / 8) * row.overtimeHours;
      labourDays += weight;
      cost += pay;
      workers.add(row.workerId);

      const skill = worker?.skill ?? 'HELPER';
      const entry = bySkill.get(skill) ?? { skill, labourDays: 0, cost: 0 };
      entry.labourDays += weight;
      entry.cost += pay;
      bySkill.set(skill, entry);

      const day = dayKey(row.markedOn);
      byDay.set(day, (byDay.get(day) ?? 0) + weight);
    }

    const stages = data.projectStages.filter((stage) => (projectId ? stage.projectId === projectId : true));
    const totalWeight = stages.reduce((acc, stage) => acc + (stage.weight > 0 ? stage.weight : 1), 0) || 1;
    const progress = round(
      stages.reduce((acc, stage) => acc + stage.progress * (stage.weight > 0 ? stage.weight : 1), 0) / totalWeight,
      2,
    );

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      labourDays: round(labourDays, 2),
      cost: round(cost, 2),
      workers: workers.size,
      avgCostPerLabourDay: labourDays > 0 ? round(cost / labourDays, 2) : 0,
      progress,
      productivity: labourDays > 0 ? round(progress / labourDays, 4) : 0,
      bySkill: Array.from(bySkill.values())
        .map((entry) => ({ ...entry, labourDays: round(entry.labourDays, 2), cost: round(entry.cost, 2) }))
        .sort((a, b) => b.labourDays - a.labourDays),
      byDay: Array.from(byDay.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, value]) => ({ date, labourDays: round(value, 2) })),
    };
  },
});

// ---------------------------------------------------------------- dpr, forecast, reports
Object.assign(handlers, {
  'GET /dpr': (context: Context) => {
    requireUser(context);
    const data = db();
    const projectId = num(context.query.projectId);
    const page = listRows(data.dprs as unknown as Record<string, unknown>[], context.query, {
      searchFields: ['workCompleted', 'siteIssues', 'safetyNotes', 'machinery', 'preparedBy'],
      dateField: 'reportDate',
      sortable: ['reportDate', 'labourCount', 'createdAt'],
      defaultSort: 'reportDate',
      filter: (row) => (projectId ? (row as unknown as { projectId: number }).projectId === projectId : true),
    });
    return { ...page, rows: page.rows.map((row) => decorateDpr(row as unknown as DprRow)) };
  },

  'GET /dpr/:id': (context: Context) => {
    requireUser(context);
    const report = byId(db().dprs, Number(context.params.id));
    if (!report) throw notFound('Daily progress report');
    return decorateDpr(report);
  },

  'POST /dpr': (context: Context) => {
    const user = requireUser(context);
    const input = dprSchema.parse(context.body);
    const data = db();
    if (!byId(data.projects, input.projectId)) throw notFound('Project');
    if (
      data.dprs.some(
        (row) =>
          row.projectId === input.projectId &&
          startOfDay(row.reportDate).getTime() === startOfDay(input.reportDate).getTime(),
      )
    ) {
      throw new LocalApiError(409, 'A report for this site and date already exists.');
    }

    const row = {
      id: nextId(data.dprs),
      projectId: input.projectId,
      reportDate: input.reportDate,
      weather: input.weather,
      workCompleted: input.workCompleted,
      labourCount: input.labourCount,
      machinery: input.machinery ?? null,
      siteIssues: input.siteIssues ?? null,
      safetyNotes: input.safetyNotes ?? null,
      preparedBy: input.preparedBy ?? user.fullName,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    data.dprs.push(row);

    for (const item of input.materials) {
      data.dprMaterials.push({
        id: nextId(data.dprMaterials),
        dprId: row.id,
        materialId: item.materialId,
        quantity: item.quantity,
      });
      if (input.deductStock) {
        data.materialUsages.push({
          id: nextId(data.materialUsages),
          materialId: item.materialId,
          projectId: input.projectId,
          quantity: item.quantity,
          usedOn: input.reportDate,
          issuedTo: 'Site (via DPR)',
          notes: `Auto-issued from DPR #${row.id}`,
          createdAt: new Date(),
        });
      }
    }

    save('dprs', 'dprMaterials', 'materialUsages');
    logActivity(user.username, 'CREATE', 'DPR', row.id);
    return decorateDpr(row);
  },

  'PUT /dpr/:id': (context: Context) => {
    const user = requireUser(context);
    const data = db();
    const report = byId(data.dprs, Number(context.params.id));
    if (!report) throw notFound('Daily progress report');
    const input = dprSchema.parse(context.body);

    Object.assign(report, {
      projectId: input.projectId,
      reportDate: input.reportDate,
      weather: input.weather,
      workCompleted: input.workCompleted,
      labourCount: input.labourCount,
      machinery: input.machinery ?? null,
      siteIssues: input.siteIssues ?? null,
      safetyNotes: input.safetyNotes ?? null,
      preparedBy: input.preparedBy ?? null,
      updatedAt: new Date(),
    });

    data.dprMaterials = data.dprMaterials.filter((row) => row.dprId !== report.id);
    for (const item of input.materials) {
      data.dprMaterials.push({
        id: nextId(data.dprMaterials),
        dprId: report.id,
        materialId: item.materialId,
        quantity: item.quantity,
      });
    }

    save('dprs', 'dprMaterials');
    logActivity(user.username, 'UPDATE', 'DPR', report.id);
    return decorateDpr(report);
  },

  'DELETE /dpr/:id': (context: Context) => {
    const user = requireUser(context);
    const data = db();
    const id = Number(context.params.id);
    if (!byId(data.dprs, id)) throw notFound('Daily progress report');
    data.dprs = data.dprs.filter((row) => row.id !== id);
    data.dprMaterials = data.dprMaterials.filter((row) => row.dprId !== id);
    data.dprPhotos = data.dprPhotos.filter((row) => row.dprId !== id);
    save('dprs', 'dprMaterials', 'dprPhotos');
    logActivity(user.username, 'DELETE', 'DPR', id);
    return { ok: true };
  },

  'POST /dpr/:id/photos': async (context: Context) => {
    requireUser(context);
    const data = db();
    const dprId = Number(context.params.id);
    if (!byId(data.dprs, dprId)) throw notFound('Daily progress report');

    const files = (context.form?.getAll('photos') ?? []).filter((item): item is File => item instanceof File);
    if (files.length === 0) throw badRequest('Attach at least one image (JPG, PNG, WEBP or GIF, up to 12 MB).');

    const caption = typeof context.form?.get('caption') === 'string' ? String(context.form?.get('caption')) : null;
    for (const file of files) {
      if (file.size > 12 * 1024 * 1024) throw badRequest(`${file.name} is larger than 12 MB.`);
      if (!file.type.startsWith('image/')) throw badRequest(`${file.name} is not an image.`);
      data.dprPhotos.push({
        id: nextId(data.dprPhotos as unknown as { id: number }[]),
        dprId,
        filePath: await fileToDataUrl(file),
        caption,
      });
    }

    save('dprPhotos');
    return data.dprPhotos.filter((row) => row.dprId === dprId);
  },

  'DELETE /dpr/photos/:photoId': (context: Context) => {
    requireUser(context);
    const data = db();
    const id = Number(context.params.photoId);
    data.dprPhotos = data.dprPhotos.filter((row) => row.id !== id);
    save('dprPhotos');
    return { ok: true };
  },

  'GET /dpr/timeline/recent': (context: Context) => {
    requireUser(context);
    const data = db();
    const projectId = num(context.query.projectId);
    return data.dprs
      .filter((row) => (projectId ? row.projectId === projectId : true))
      .sort((a, b) => b.reportDate.getTime() - a.reportDate.getTime())
      .slice(0, 60)
      .map((row) => ({
        id: row.id,
        reportDate: row.reportDate,
        weather: row.weather,
        labourCount: row.labourCount,
        workCompleted: row.workCompleted,
        project: data.projects.find((item) => item.id === row.projectId) ?? null,
        _count: {
          photos: data.dprPhotos.filter((item) => item.dprId === row.id).length,
          materials: data.dprMaterials.filter((item) => item.dprId === row.id).length,
        },
      }));
  },

  // ---------------------------------------------------------------- forecast
  'GET /forecast': (context: Context) => {
    requireUser(context);
    return buildAllForecasts();
  },

  'GET /forecast/:projectId': (context: Context) => {
    requireUser(context);
    const forecast = buildForecast(Number(context.params.projectId));
    if (!forecast) throw notFound('Project');
    return forecast;
  },

  'POST /forecast/:projectId/snapshot': (context: Context) => {
    requireUser(context);
    const forecast = buildForecast(Number(context.params.projectId));
    if (!forecast) throw notFound('Project');
    const data = db();
    data.forecastSnapshots.push({
      id: nextId(data.forecastSnapshots),
      projectId: forecast.projectId,
      runOn: new Date(),
      progressPct: forecast.progressPct,
      avgDailyProgress: forecast.avgDailyProgress,
      estimatedCompletion: forecast.estimatedCompletion ? new Date(forecast.estimatedCompletion) : null,
      delayDays: forecast.delayDays,
      riskLevel: forecast.riskLevel,
      requiredLabour: forecast.labour.requiredLabourPerDay,
      costProjection: forecast.cost.projectedTotal,
      payload: JSON.stringify({
        labour: forecast.labour,
        material: forecast.material,
        cost: forecast.cost,
        notes: forecast.notes,
      }),
      createdAt: new Date(),
    });
    save('forecastSnapshots');
    return forecast;
  },

  'GET /forecast/:projectId/snapshots': (context: Context) => {
    requireUser(context);
    const projectId = Number(context.params.projectId);
    return db()
      .forecastSnapshots.filter((row) => row.projectId === projectId)
      .sort((a, b) => a.runOn.getTime() - b.runOn.getTime());
  },

  // ---------------------------------------------------------------- reports
  'GET /reports': (context: Context) => {
    requireUser(context);
    return REPORTS;
  },

  'GET /reports/:key': (context: Context) => {
    requireUser(context);
    const key = String(context.params.key);
    if (!REPORTS.some((report) => report.key === key)) throw badRequest('Unknown report.');
    return buildReport(key, context.query);
  },

  // ---------------------------------------------------------------- settings
  'GET /settings': (context: Context) => {
    requireUser(context);
    return readSettings();
  },

  'PUT /settings': (context: Context) => {
    const user = requireUser(context);
    const saved = writeSettings(context.body);
    logActivity(user.username, 'UPDATE', 'Settings');
    return saved;
  },

  'GET /users': (context: Context) => {
    requireUser(context);
    return db().users.map((user) => ({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      active: user.active,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    }));
  },

  // ---------------------------------------------------------------- backups
  'GET /backups': (context: Context) => {
    requireUser(context);
    return {
      folder: 'Stored in this browser',
      files: db()
        .backups.slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((backup) => ({ name: backup.name, size: backup.size, createdAt: backup.createdAt })),
    };
  },

  'POST /backups': (context: Context) => {
    const user = requireUser(context);
    const data = db();
    const payload = serialiseDatabase();
    const backup = {
      name: `CRM_Backup_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`,
      createdAt: new Date(),
      size: new Blob([payload]).size,
      payload,
    };
    data.backups.push(backup);
    // Keep the ten most recent so the browser's storage quota is respected.
    if (data.backups.length > 10) data.backups = data.backups.slice(-10);
    save('backups');
    logActivity(user.username, 'BACKUP', 'Database', undefined, backup.name);
    return { name: backup.name, size: backup.size, createdAt: backup.createdAt };
  },

  'POST /backups/upload': async (context: Context) => {
    requireUser(context);
    const file = context.form?.get('backup');
    if (!(file instanceof File)) throw badRequest('Choose a backup file to upload.');
    const payload = await file.text();
    try {
      parseDatabase(payload);
    } catch {
      throw badRequest('That file is not a CRM backup.');
    }
    const data = db();
    const backup = {
      name: `CRM_Backup_imported-${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}`,
      createdAt: new Date(),
      size: file.size,
      payload,
    };
    data.backups.push(backup);
    save('backups');
    return { name: backup.name, size: backup.size, createdAt: backup.createdAt };
  },

  'POST /backups/:name/restore': async (context: Context) => {
    const user = requireUser(context);
    const data = db();
    const name = decodeURIComponent(String(context.params.name));
    const backup = data.backups.find((row) => row.name === name);
    if (!backup) throw notFound('Backup');

    // Take a safety copy of the current data before swapping it out, and carry
    // both the backup list and the active session across the restore.
    const safety = {
      name: `CRM_Backup_pre-restore-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`,
      createdAt: new Date(),
      size: new Blob([serialiseDatabase()]).size,
      payload: serialiseDatabase(),
    };

    const next = parseDatabase(backup.payload);
    next.backups = [...data.backups, safety].slice(-10);
    next.sessions = data.sessions;
    if (next.users.length === 0) next.users = data.users;

    await replaceDatabase(next);
    logActivity(user.username, 'RESTORE', 'Database', undefined, name);
    return { restoredFrom: name, safetyCopy: safety.name, restartRequired: true };
  },

  'DELETE /backups/:name': (context: Context) => {
    requireUser(context);
    const data = db();
    const name = decodeURIComponent(String(context.params.name));
    data.backups = data.backups.filter((row) => row.name !== name);
    save('backups');
    return { ok: true };
  },

  // ---------------------------------------------------------------- search
  'GET /search': (context: Context) => {
    requireUser(context);
    const term = String(context.query.q ?? '').trim().toLowerCase();
    if (term.length < 2) return [];
    const data = db();
    const take = 6;
    const has = (value: unknown): boolean => value != null && String(value).toLowerCase().includes(term);

    const hits: GlobalSearchHit[] = [
      ...data.leads
        .filter((row) => has(row.name) || has(row.phone) || has(row.email))
        .slice(0, take)
        .map((row) => ({
          type: 'lead' as const,
          id: row.id,
          title: row.name,
          subtitle: `Lead • ${row.phone} • ${row.status}`,
          href: `/leads?focus=${row.id}`,
        })),
      ...data.clients
        .filter((row) => has(row.name) || has(row.phone) || has(row.panNo))
        .slice(0, take)
        .map((row) => ({
          type: 'client' as const,
          id: row.id,
          title: row.name,
          subtitle: `Client • ${row.phone}`,
          href: `/clients/${row.id}`,
        })),
      ...data.properties
        .filter((row) => has(row.unit) || has(row.tower))
        .slice(0, take)
        .map((row) => ({
          type: 'property' as const,
          id: row.id,
          title: `${row.tower}-${row.unit}`,
          subtitle: `Unit • ${data.projects.find((p) => p.id === row.projectId)?.name ?? ''} • ${row.status}`,
          href: `/properties?focus=${row.id}`,
        })),
      ...data.projects
        .filter((row) => has(row.name) || has(row.code) || has(row.location))
        .slice(0, take)
        .map((row) => ({
          type: 'project' as const,
          id: row.id,
          title: row.name,
          subtitle: `Project • ${row.code} • ${row.location}`,
          href: `/projects/${row.id}`,
        })),
      ...data.workers
        .filter((row) => has(row.name) || has(row.mobile) || has(row.contractor))
        .slice(0, take)
        .map((row) => ({
          type: 'worker' as const,
          id: row.id,
          title: row.name,
          subtitle: `Worker • ${row.skill}${row.contractor ? ` • ${row.contractor}` : ''}`,
          href: `/labour?focus=${row.id}`,
        })),
      ...data.materials
        .filter((row) => has(row.name))
        .slice(0, take)
        .map((row) => ({
          type: 'material' as const,
          id: row.id,
          title: row.name,
          subtitle: `Material • ${row.category} • ${row.unit}`,
          href: `/inventory?focus=${row.id}`,
        })),
      ...data.dprs
        .filter((row) => has(row.workCompleted) || has(row.siteIssues))
        .slice(0, take)
        .map((row) => ({
          type: 'dpr' as const,
          id: row.id,
          title: `DPR ${row.reportDate.toISOString().slice(0, 10)}`,
          subtitle: `${data.projects.find((p) => p.id === row.projectId)?.name ?? ''} • ${row.workCompleted.slice(0, 60)}`,
          href: `/dpr?focus=${row.id}`,
        })),
    ];

    return hits;
  },

  'GET /health': () => ({ ok: true, version: '1.0.0', mode: 'browser' }),
});

function decorateDpr(report: DprRow): Record<string, unknown> {
  const data = db();
  return {
    ...report,
    project: data.projects.find((row) => row.id === report.projectId) ?? null,
    materials: data.dprMaterials
      .filter((row) => row.dprId === report.id)
      .map((row) => ({
        ...row,
        material: data.materials.find((item) => item.id === row.materialId) ?? null,
      })),
    photos: data.dprPhotos.filter((row) => row.dprId === report.id),
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });
}

/** Turns a Zod failure into the message the UI shows. */
export function describeError(error: unknown): LocalApiError {
  if (error instanceof LocalApiError) return error;
  if (error instanceof z.ZodError) {
    const first = error.errors[0];
    return new LocalApiError(422, first ? `${first.message}` : 'Please check the highlighted fields.');
  }
  console.error('[local-api] unhandled error:', error);
  return new LocalApiError(500, 'Something went wrong. The action was not saved.');
}
