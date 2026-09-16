import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler, notFound } from '../lib/errors';
import { crudRouter } from '../lib/crud';
import type { AuthedRequest } from '../lib/auth';
import { round } from '../lib/query';
import { bookingSchema, clientSchema, interactionSchema, paymentSchema } from '../../shared/schemas';

export const clientsRouter = Router();

const listInclude = {
  bookings: {
    include: { property: { select: { tower: true, unit: true, projectId: true } } },
  },
  payments: { select: { amount: true } },
};

/**
 * Everything the client detail screen shows: bookings, payments, documents and
 * a single merged timeline of every interaction.
 */
clientsRouter.get(
  '/:id/timeline',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const clientId = Number(req.params.id);
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw notFound('Client');

    const [interactions, payments, bookings, documents] = await Promise.all([
      prisma.interaction.findMany({ where: { clientId }, orderBy: { happenedOn: 'desc' } }),
      prisma.payment.findMany({ where: { clientId }, orderBy: { paidOn: 'desc' } }),
      prisma.booking.findMany({
        where: { clientId },
        include: { property: { select: { tower: true, unit: true } }, project: { select: { name: true } } },
        orderBy: { bookingDate: 'desc' },
      }),
      prisma.document.findMany({ where: { clientId }, orderBy: { uploadedAt: 'desc' } }),
    ]);

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

    res.json({
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
    });
  }),
);

clientsRouter.post(
  '/:id/interactions',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const clientId = Number(req.params.id);
    const input = interactionSchema.parse({ ...req.body, clientId });
    const row = await prisma.interaction.create({ data: input });
    res.status(201).json(row);
  }),
);

clientsRouter.use(
  crudRouter({
    delegate: prisma.client,
    entity: 'Client',
    schema: clientSchema,
    searchFields: ['name', 'phone', 'email', 'panNo'],
    sortable: ['createdAt', 'name'],
    defaultSort: 'createdAt',
    dateField: 'createdAt',
    listInclude,
  }),
);

// ------------------------------------------------------------------ bookings

export const bookingsRouter = Router();

bookingsRouter.use(
  crudRouter({
    delegate: prisma.booking,
    entity: 'Booking',
    schema: bookingSchema,
    searchFields: ['agreementNo', 'notes'],
    sortable: ['bookingDate', 'agreementValue', 'createdAt'],
    defaultSort: 'bookingDate',
    dateField: 'bookingDate',
    listInclude: {
      client: { select: { id: true, name: true, phone: true } },
      property: { select: { id: true, tower: true, unit: true, unitType: true } },
      project: { select: { id: true, name: true } },
      payments: { select: { amount: true } },
    },
    filters: (query) => (query.clientId ? { clientId: query.clientId } : null),
    /** A booking takes the unit off the market; cancelling puts it back. */
    afterWrite: async (row) => {
      const status = row.status === 'CANCELLED' ? 'AVAILABLE' : 'SOLD';
      await prisma.property.update({ where: { id: row.propertyId }, data: { status } });
      await prisma.interaction.create({
        data: {
          clientId: row.clientId,
          type: 'NOTE',
          detail: `Booking #${row.id} ${row.status.toLowerCase()}.`,
        },
      });
    },
    beforeDelete: async (id) => {
      const booking = await prisma.booking.findUnique({ where: { id } });
      if (booking) {
        await prisma.property.update({ where: { id: booking.propertyId }, data: { status: 'AVAILABLE' } });
      }
    },
  }),
);

// ------------------------------------------------------------------ payments

export const paymentsRouter = Router();

paymentsRouter.use(
  crudRouter({
    delegate: prisma.payment,
    entity: 'Payment',
    schema: paymentSchema,
    searchFields: ['reference', 'notes'],
    sortable: ['paidOn', 'amount', 'createdAt'],
    defaultSort: 'paidOn',
    dateField: 'paidOn',
    listInclude: {
      client: { select: { id: true, name: true, phone: true } },
      booking: { select: { id: true, agreementNo: true } },
    },
    filters: (query) => (query.clientId ? { clientId: query.clientId } : null),
  }),
);
