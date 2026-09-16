import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler, notFound } from '../lib/errors';
import { crudRouter } from '../lib/crud';
import { logActivity } from '../lib/activity';
import type { AuthedRequest } from '../lib/auth';
import { combine, endOfDay, startOfDay } from '../lib/query';
import { convertLeadSchema, leadActivitySchema, leadSchema } from '../../shared/schemas';

export const leadsRouter = Router();

const listInclude = {
  interestedProperty: { select: { id: true, tower: true, unit: true, status: true } },
  project: { select: { id: true, name: true } },
};

/** Follow-ups that are due today or already overdue. */
leadsRouter.get(
  '/follow-ups',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const days = Number(req.query.days ?? 7);
    const today = new Date();
    const rows = await prisma.lead.findMany({
      where: {
        status: { notIn: ['WON', 'LOST'] },
        followUpDate: { not: null, lte: endOfDay(new Date(today.getTime() + days * 86_400_000)) },
      },
      include: listInclude,
      orderBy: { followUpDate: 'asc' },
      take: 200,
    });
    const start = startOfDay(today);
    res.json({
      overdue: rows.filter((lead) => lead.followUpDate! < start),
      today: rows.filter(
        (lead) => lead.followUpDate! >= start && lead.followUpDate! <= endOfDay(today),
      ),
      upcoming: rows.filter((lead) => lead.followUpDate! > endOfDay(today)),
    });
  }),
);

leadsRouter.get(
  '/:id/activities',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const leadId = Number(req.params.id);
    const rows = await prisma.leadActivity.findMany({
      where: { leadId },
      orderBy: { happenedOn: 'desc' },
    });
    res.json(rows);
  }),
);

leadsRouter.post(
  '/:id/activities',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const leadId = Number(req.params.id);
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw notFound('Lead');

    const input = leadActivitySchema.parse(req.body);
    const row = await prisma.leadActivity.create({ data: { ...input, leadId } });
    res.status(201).json(row);
  }),
);

/**
 * Converts a won lead into a client, optionally booking the unit the lead was
 * interested in. Everything happens in one transaction so a half-converted lead
 * can never exist.
 */
leadsRouter.post(
  '/:id/convert',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const leadId = Number(req.params.id);
    const input = convertLeadSchema.parse(req.body);
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw notFound('Lead');

    const actor = req.user?.username ?? 'system';
    const result = await prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          address: input.address ?? null,
          panNo: input.panNo ?? null,
          notes: lead.notes,
        },
      });

      await tx.interaction.create({
        data: {
          clientId: client.id,
          type: 'NOTE',
          detail: `Converted from lead #${lead.id} (${lead.source.toLowerCase()}).`,
        },
      });

      const propertyId = input.propertyId ?? lead.interestedPropertyId ?? null;
      if (input.createBooking && propertyId) {
        const property = await tx.property.findUnique({ where: { id: propertyId } });
        if (!property) throw notFound('Property');
        await tx.booking.create({
          data: {
            clientId: client.id,
            propertyId,
            projectId: property.projectId,
            bookingDate: new Date(),
            agreementValue: input.agreementValue || property.price,
            bookingAmount: input.bookingAmount,
          },
        });
        await tx.property.update({ where: { id: propertyId }, data: { status: 'SOLD' } });
      }

      await tx.lead.update({
        where: { id: lead.id },
        data: { status: 'WON', convertedClientId: client.id },
      });
      await tx.leadActivity.create({
        data: { leadId: lead.id, type: 'STATUS_CHANGE', detail: `Converted to client #${client.id}.` },
      });

      return client;
    });

    await logActivity({ actor, action: 'CONVERT', entity: 'Lead', entityId: leadId, detail: `Client #${result.id}` });
    res.status(201).json(result);
  }),
);

leadsRouter.use(
  crudRouter({
    delegate: prisma.lead,
    entity: 'Lead',
    schema: leadSchema,
    searchFields: ['name', 'phone', 'email', 'assignedTo', 'notes'],
    sortable: ['createdAt', 'name', 'budget', 'followUpDate', 'status'],
    defaultSort: 'createdAt',
    dateField: 'createdAt',
    listInclude,
    detailInclude: { ...listInclude, activities: { orderBy: { happenedOn: 'desc' } } },
    filters: (query) =>
      combine(
        query.status ? { status: query.status } : null,
        query.source ? { source: query.source } : null,
        query.projectId ? { projectId: query.projectId } : null,
      ),
    afterWrite: async (row, mode, actor) => {
      if (mode === 'create') {
        await prisma.leadActivity.create({
          data: { leadId: row.id, type: 'NOTE', detail: `Lead created by ${actor}.` },
        });
      }
    },
  }),
);

/** Used by the pipeline board to move a lead between columns. */
leadsRouter.patch(
  '/:id/status',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const id = Number(req.params.id);
    const status = leadSchema.shape.status.parse(req.body.status);
    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) throw notFound('Lead');

    const updated = await prisma.lead.update({ where: { id }, data: { status } });
    await prisma.leadActivity.create({
      data: { leadId: id, type: 'STATUS_CHANGE', detail: `Status changed from ${lead.status} to ${status}.` },
    });
    await logActivity({
      actor: req.user?.username ?? 'system',
      action: 'STATUS',
      entity: 'Lead',
      entityId: id,
      detail: status,
    });
    res.json(updated);
  }),
);
