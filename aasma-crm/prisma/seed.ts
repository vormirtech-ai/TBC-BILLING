/**
 * Demo data for a fresh install.
 *
 * It builds a believable six-month picture for two sites — leads at every stage
 * of the pipeline, sold and available units, daily attendance, material issues
 * and daily progress reports — so every chart, report and forecast has something
 * real to show the first time the app is opened.
 *
 * Running it twice is safe: it clears the tables it owns first.
 */
import { prisma } from '../server/lib/prisma';
import { ensureDatabase, ensureAdminUser } from '../server/bootstrap';
import { saveSettings } from '../server/lib/settings';
import { DEFAULT_STAGES } from '../shared/constants';

/** Small deterministic generator so the demo data is the same on every install. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const random = makeRandom(20260828);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
const between = (min: number, max: number): number => Math.round(min + random() * (max - min));

function daysAgo(days: number): Date {
  const date = new Date();
  date.setHours(9, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}

const FIRST_NAMES = ['Rajesh', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Anita', 'Suresh', 'Kavita', 'Manish', 'Deepa', 'Arun', 'Pooja', 'Ravi', 'Neha', 'Sanjay', 'Meera', 'Rohit', 'Divya', 'Nitin', 'Shalini'];
const LAST_NAMES = ['Sharma', 'Patel', 'Verma', 'Joshi', 'Nair', 'Reddy', 'Desai', 'Kulkarni', 'Mehta', 'Gupta', 'Shah', 'Iyer'];
const WORKER_NAMES = ['Ramesh', 'Shyam', 'Mohan', 'Dinesh', 'Kailash', 'Bhola', 'Ganesh', 'Prakash', 'Santosh', 'Vijay', 'Lakhan', 'Om Prakash', 'Jagdish', 'Naresh', 'Sunil', 'Chandan', 'Devi Lal', 'Hari', 'Kishan', 'Mahesh', 'Nandu', 'Pappu', 'Raju', 'Sohan', 'Tej Singh', 'Umesh', 'Yashpal', 'Ashok', 'Balram', 'Chetan'];
const CONTRACTORS = ['Shree Balaji Labour', 'M. K. Contractors', 'Aasma Direct', 'Vishwakarma Enterprises'];

function personName(): string {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

function phoneNumber(): string {
  return `9${between(100000000, 899999999)}`;
}

async function clearDemoData(): Promise<void> {
  // Order matters: children before parents, even with cascade rules in place.
  await prisma.dprPhoto.deleteMany();
  await prisma.dprMaterial.deleteMany();
  await prisma.dpr.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.materialUsage.deleteMany();
  await prisma.stockAdjustment.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.material.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.document.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.leadActivity.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.client.deleteMany();
  await prisma.property.deleteMany();
  await prisma.forecastSnapshot.deleteMany();
  await prisma.stageProgressLog.deleteMany();
  await prisma.projectStage.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.project.deleteMany();
  await prisma.activityLog.deleteMany();
}

async function main(): Promise<void> {
  ensureDatabase();
  await ensureAdminUser();
  console.log('Seeding demo data…');
  await clearDemoData();

  await saveSettings({
    companyName: 'Aasma Construction',
    companyAddress: 'Aasma House, Ring Road, Indore, Madhya Pradesh 452001',
    companyPhone: '+91 731 400 8800',
    companyEmail: 'contact@aasmaconstruction.in',
    gstNo: '23AAAAA0000A1Z5',
    currency: '₹',
    financialYearStart: '04-01',
    lowStockAlerts: true,
    followUpReminderDays: 3,
  });

  // ---------------------------------------------------------------- projects
  const projectSeeds = [
    {
      name: 'Aasma Greens — Site A',
      code: 'AG-A',
      location: 'Super Corridor, Indore',
      startDate: daysAgo(220),
      expectedEndDate: daysAgo(-160),
      budget: 185_000_000,
      contractor: 'M. K. Contractors',
      engineer: 'Er. Ashish Rathore',
      status: 'ACTIVE',
      description: 'Two towers of 2 and 3 BHK apartments with a clubhouse.',
      pace: 1.0,
      towers: ['A', 'B'],
      floors: 8,
      unitsPerFloor: 4,
    },
    {
      name: 'Aasma Heights — Site B',
      code: 'AH-B',
      location: 'Rau, Indore',
      startDate: daysAgo(140),
      expectedEndDate: daysAgo(-40),
      budget: 96_000_000,
      contractor: 'Vishwakarma Enterprises',
      engineer: 'Er. Sunita Rane',
      status: 'ACTIVE',
      description: 'Single tower of compact 1 and 2 BHK homes.',
      pace: 0.62,
      towers: ['T1'],
      floors: 6,
      unitsPerFloor: 4,
    },
  ];

  const projects = [];
  for (const seed of projectSeeds) {
    const { pace, towers, floors, unitsPerFloor, ...data } = seed;
    const project = await prisma.project.create({ data });

    // Stages, with progress that tapers off down the sequence.
    let index = 0;
    for (const stage of DEFAULT_STAGES) {
      const ceiling = Math.max(0, 100 - index * 16);
      const progress = Math.min(100, Math.round(ceiling * pace));
      const created = await prisma.projectStage.create({
        data: { projectId: project.id, name: stage.name, weight: stage.weight, progress, sortOrder: index },
      });

      // A progress history so the forecasting engine has a measurable rate.
      const points = 6;
      for (let step = 1; step <= points; step += 1) {
        await prisma.stageProgressLog.create({
          data: {
            stageId: created.id,
            progress: Math.round((progress / points) * step),
            recordedOn: daysAgo(Math.round((points - step) * 12) + 2),
            note: step === points ? 'Latest site update' : null,
          },
        });
      }
      index += 1;
    }

    for (const [milestoneIndex, title] of [
      'Foundation certified',
      'Slab casting complete',
      'Brick work handover',
      'Internal plaster complete',
      'Possession ready',
    ].entries()) {
      const dueDate = daysAgo(160 - milestoneIndex * 55);
      const done = dueDate < new Date() && milestoneIndex < 2;
      await prisma.milestone.create({
        data: {
          projectId: project.id,
          title,
          dueDate,
          completedOn: done ? dueDate : null,
          status: done ? 'DONE' : dueDate < new Date() ? 'DELAYED' : 'PENDING',
        },
      });
    }

    // Units.
    const unitTypes = ['2BHK', '3BHK', '2BHK', '1BHK'];
    for (const tower of towers) {
      for (let floor = 1; floor <= floors; floor += 1) {
        for (let unitIndex = 0; unitIndex < unitsPerFloor; unitIndex += 1) {
          const unitType = unitTypes[unitIndex % unitTypes.length];
          const size = unitType === '3BHK' ? 1450 : unitType === '2BHK' ? 1080 : 640;
          const roll = random();
          await prisma.property.create({
            data: {
              projectId: project.id,
              tower,
              floor,
              unit: `${floor}0${unitIndex + 1}`,
              unitType,
              sizeSqft: size,
              price: Math.round(size * between(4200, 5200)),
              facing: pick(['EAST', 'WEST', 'NORTH', 'SOUTH', 'NORTH_EAST', 'SOUTH_WEST']),
              status: roll < 0.34 ? 'SOLD' : roll < 0.46 ? 'RESERVED' : 'AVAILABLE',
            },
          });
        }
      }
    }

    projects.push(project);
  }

  const allProperties = await prisma.property.findMany();
  const soldProperties = allProperties.filter((property) => property.status === 'SOLD');

  // ---------------------------------------------------------------- clients
  const clients = [];
  for (const property of soldProperties) {
    const client = await prisma.client.create({
      data: {
        name: personName(),
        phone: phoneNumber(),
        email: `owner${property.id}@example.com`,
        address: `${between(10, 900)}, ${pick(['Vijay Nagar', 'Palasia', 'Rau', 'Bicholi', 'Mhow Naka'])}, Indore`,
        panNo: `ABCPD${between(1000, 9999)}K`,
      },
    });

    const bookingDate = daysAgo(between(10, 190));
    const agreementValue = property.price;
    const booking = await prisma.booking.create({
      data: {
        clientId: client.id,
        propertyId: property.id,
        projectId: property.projectId,
        bookingDate,
        agreementValue,
        bookingAmount: Math.round(agreementValue * 0.1),
        agreementNo: `AGR/${property.tower}${property.unit}/${bookingDate.getFullYear()}`,
        status: 'ACTIVE',
      },
    });

    // Two to four instalments per booking.
    const instalments = between(2, 4);
    for (let step = 0; step < instalments; step += 1) {
      await prisma.payment.create({
        data: {
          clientId: client.id,
          bookingId: booking.id,
          amount: Math.round((agreementValue * (step === 0 ? 0.1 : 0.15)) / 1) ,
          mode: pick(['BANK', 'CHEQUE', 'UPI', 'LOAN']),
          paidOn: daysAgo(Math.max(1, between(5, 180) - step * 20)),
          reference: `TXN${between(100000, 999999)}`,
        },
      });
    }

    await prisma.interaction.create({
      data: {
        clientId: client.id,
        type: 'SITE_VISIT',
        detail: `Site visit for ${property.tower}-${property.unit} before booking.`,
        happenedOn: daysAgo(between(30, 200)),
      },
    });

    clients.push(client);
  }

  // ---------------------------------------------------------------- leads
  const statuses = ['NEW', 'CONTACTED', 'INTERESTED', 'SITE_VISIT', 'NEGOTIATION', 'WON', 'LOST'] as const;
  const available = allProperties.filter((property) => property.status !== 'SOLD');

  for (let index = 0; index < 64; index += 1) {
    const status = index < 46 ? pick(statuses.slice(0, 5)) : pick(statuses);
    const property = pick(available);
    const createdAt = daysAgo(between(1, 150));
    const lead = await prisma.lead.create({
      data: {
        name: personName(),
        phone: phoneNumber(),
        email: random() > 0.35 ? `lead${index}@example.com` : null,
        source: pick(['WALK_IN', 'REFERRAL', 'WEBSITE', 'CALL', 'BROKER', 'CAMPAIGN']),
        budget: between(2500000, 9500000),
        interestedPropertyId: property.id,
        projectId: property.projectId,
        followUpDate: ['WON', 'LOST'].includes(status) ? null : daysAgo(between(-12, 6)),
        status,
        assignedTo: pick(['Neha Sales', 'Rohit Sales', 'Front Desk']),
        notes: pick([
          'Looking for an east-facing unit on a higher floor.',
          'Bank loan pre-approved, wants possession within a year.',
          'Comparing with a competing project nearby.',
          'Family of four, needs two parking slots.',
        ]),
        createdAt,
      },
    });

    await prisma.leadActivity.create({
      data: { leadId: lead.id, type: 'CALL', detail: 'First call — shared price list and floor plans.', happenedOn: createdAt },
    });
    if (['SITE_VISIT', 'NEGOTIATION', 'WON'].includes(status)) {
      await prisma.leadActivity.create({
        data: {
          leadId: lead.id,
          type: 'VISIT',
          detail: `Visited ${property.tower}-${property.unit}.`,
          happenedOn: daysAgo(between(1, 40)),
        },
      });
    }
  }

  // ---------------------------------------------------------------- inventory
  const materialSeeds = [
    { name: 'OPC 53 Grade Cement', category: 'CEMENT', unit: 'Bag', rate: 395, openingStock: 400, reorderLevel: 150 },
    { name: 'River Sand', category: 'SAND', unit: 'Brass', rate: 4800, openingStock: 40, reorderLevel: 15 },
    { name: 'TMT Steel Fe500 12mm', category: 'STEEL', unit: 'Ton', rate: 62500, openingStock: 22, reorderLevel: 8 },
    { name: 'TMT Steel Fe500 8mm', category: 'STEEL', unit: 'Ton', rate: 63200, openingStock: 14, reorderLevel: 6 },
    { name: 'Red Clay Bricks', category: 'BRICKS', unit: 'Nos', rate: 9, openingStock: 60000, reorderLevel: 15000 },
    { name: 'AAC Blocks 600x200', category: 'BRICKS', unit: 'Nos', rate: 58, openingStock: 4200, reorderLevel: 1200 },
    { name: '20mm Aggregate', category: 'GRAVEL', unit: 'Brass', rate: 5200, openingStock: 26, reorderLevel: 10 },
    { name: 'Interior Emulsion Paint', category: 'PAINT', unit: 'Litre', rate: 235, openingStock: 900, reorderLevel: 300 },
    { name: 'CPVC Pipe 25mm', category: 'PIPES', unit: 'Metre', rate: 145, openingStock: 1800, reorderLevel: 600 },
    { name: 'PVC Drain Pipe 110mm', category: 'PIPES', unit: 'Metre', rate: 310, openingStock: 700, reorderLevel: 250 },
    { name: 'Copper Wire 2.5 sqmm', category: 'ELECTRICAL', unit: 'Coil', rate: 2150, openingStock: 85, reorderLevel: 30 },
    { name: 'Modular Switch Board', category: 'ELECTRICAL', unit: 'Nos', rate: 640, openingStock: 320, reorderLevel: 120 },
  ] as const;

  const materials = [];
  for (const seed of materialSeeds) {
    materials.push(await prisma.material.create({ data: { ...seed } }));
  }

  for (const material of materials) {
    // Two or three purchases each, spread over the last five months.
    for (let step = 0; step < between(2, 3); step += 1) {
      const quantity = Math.round(material.openingStock * (0.4 + random() * 0.8));
      await prisma.purchase.create({
        data: {
          materialId: material.id,
          projectId: pick(projects).id,
          quantity,
          rate: material.rate,
          amount: Math.round(quantity * material.rate),
          supplier: pick(['Shree Traders', 'Balaji Suppliers', 'Indore Cement Depot', 'Metro Hardware']),
          invoiceNo: `INV-${between(1000, 9999)}`,
          purchasedOn: daysAgo(between(10, 150)),
        },
      });
    }

    // Daily issues to site for the last 45 days.
    for (let day = 45; day >= 0; day -= 1) {
      if (random() > 0.55) continue;
      await prisma.materialUsage.create({
        data: {
          materialId: material.id,
          projectId: pick(projects).id,
          quantity: Math.max(1, Math.round(material.openingStock * (0.005 + random() * 0.02))),
          usedOn: daysAgo(day),
          issuedTo: pick(['Site Store', 'Mason Team A', 'Mason Team B', 'Electrical Team']),
        },
      });
    }

    if (random() > 0.7) {
      await prisma.stockAdjustment.create({
        data: {
          materialId: material.id,
          quantity: -Math.round(material.openingStock * 0.01),
          reason: pick(['DAMAGE', 'WASTAGE']),
          adjustedOn: daysAgo(between(3, 60)),
          notes: 'Recorded during monthly stock verification.',
        },
      });
    }
  }

  // ---------------------------------------------------------------- labour
  const workers = [];
  for (const [index, name] of WORKER_NAMES.entries()) {
    const skill = pick(['MASON', 'CARPENTER', 'ELECTRICIAN', 'PLUMBER', 'PAINTER', 'HELPER', 'OPERATOR', 'SUPERVISOR'] as const);
    const wage = skill === 'SUPERVISOR' ? 950 : skill === 'HELPER' ? 480 : between(600, 820);
    workers.push(
      await prisma.worker.create({
        data: {
          name: `${name} ${pick(LAST_NAMES)}`,
          mobile: phoneNumber(),
          skill,
          contractor: pick(CONTRACTORS),
          dailyWage: wage,
          projectId: projects[index % projects.length].id,
          joinedOn: daysAgo(between(60, 200)),
        },
      }),
    );
  }

  for (let day = 45; day >= 0; day -= 1) {
    const date = daysAgo(day);
    if (date.getDay() === 0) continue; // Sunday off.
    for (const worker of workers) {
      const roll = random();
      const status = roll < 0.82 ? 'PRESENT' : roll < 0.9 ? 'HALF_DAY' : 'ABSENT';
      await prisma.attendance.create({
        data: {
          workerId: worker.id,
          projectId: worker.projectId,
          markedOn: date,
          status,
          overtimeHours: status === 'PRESENT' && random() > 0.82 ? between(1, 3) : 0,
        },
      });
    }
  }

  // ---------------------------------------------------------------- dpr
  const weatherOptions = ['CLEAR', 'CLOUDY', 'RAIN', 'HOT'] as const;
  for (const project of projects) {
    for (let day = 21; day >= 0; day -= 1) {
      const date = daysAgo(day);
      if (date.getDay() === 0) continue;
      const dpr = await prisma.dpr.create({
        data: {
          projectId: project.id,
          reportDate: date,
          weather: pick(weatherOptions),
          workCompleted: pick([
            'Slab shuttering completed for the fifth floor; reinforcement tied and checked.',
            'Brick work in progress on floors two and three, four masons deployed.',
            'Internal plaster completed for eight units; curing under way.',
            'Electrical conduiting completed on the second floor.',
            'Plumbing risers installed and pressure tested up to the third floor.',
            'External painting primer coat applied on the north elevation.',
          ]),
          labourCount: between(24, 48),
          machinery: pick(['1 concrete mixer, 1 lift', '2 vibrators, 1 mixer', '1 JCB (half day)', '1 mixer, 1 hoist']),
          siteIssues: random() > 0.72 ? pick(['Cement delivery delayed by two hours.', 'Rain stopped work after 3 pm.', 'Power outage for one hour.']) : null,
          safetyNotes: pick(['Toolbox talk conducted; helmets checked.', 'Safety nets inspected on the outer face.', 'No incidents reported.']),
          preparedBy: pick(['Er. Ashish Rathore', 'Er. Sunita Rane', 'Site Supervisor']),
        },
      });

      for (const material of materials.slice(0, 4)) {
        if (random() > 0.5) continue;
        await prisma.dprMaterial.create({
          data: {
            dprId: dpr.id,
            materialId: material.id,
            quantity: Math.max(1, Math.round(material.openingStock * 0.01)),
          },
        });
      }
    }
  }

  const counts = {
    projects: await prisma.project.count(),
    properties: await prisma.property.count(),
    leads: await prisma.lead.count(),
    clients: await prisma.client.count(),
    materials: await prisma.material.count(),
    workers: await prisma.worker.count(),
    attendance: await prisma.attendance.count(),
    dpr: await prisma.dpr.count(),
  };
  console.log('Demo data ready:', counts);
}

main()
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
