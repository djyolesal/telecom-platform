import { rendreEmail } from './daily-recap';

jest.mock('../config/database', () => ({ prisma: {} }));
jest.mock('../services/email.service', () => ({ sendEmail: jest.fn() }));
jest.mock('../services/settings.service', () => ({ getNum: jest.fn(() => 1) }));

const blocs = {
  passif: {
    terminees: 12, terminesAujourdhui: 2, enCours: 3, planifiees: 5,
    enRetard: [{ site: 'MAR-004', equipement: 'GE n°1 (planifiée)', datePlanifiee: new Date('2026-08-20') }],
  },
  solaire: { terminees: 4, terminesAujourdhui: 0, enCours: 1, planifiees: 2, enRetard: [] },
  depotages: { nombre: 7, litres: 4250, aujourdhui: 1 },
  incidents: {
    ouvertsPeriode: 9, resolus: 6, encoreOuverts: 3, ouvertsAujourdhui: 1,
    critiquesOuverts: [{ site: 'PLA-002', reference: 'INC-2026-0101', depuis: new Date('2026-08-28') }],
  },
};

// Les gabarits et toLocaleString('fr-FR') emploient des espaces typographiques
// (insécable U+00A0, fine U+202F) : on normalise avant d'asserter.
const normal = (s: string) => s.replace(/[  ]/g, ' ');

describe('rendreEmail (récap journalier)', () => {
  it('rend toutes les sections avec les compteurs et l’avancement', () => {
    const html = normal(rendreEmail(blocs, new Date('2026-08-30'), 'Parc entier'));
    expect(html).toContain('Récap journalier');
    expect(html).toContain('Parc entier');
    expect(html).toContain('Maintenance passive / active');
    expect(html).toContain('Maintenance solaire');
    // avancement passif : 12 terminées / (12+3+5) = 60 %
    expect(html).toContain('60 %');
    expect(html).toContain("+2 aujourd'hui");
    expect(html).toContain('MAR-004');
    expect(html).toContain('4 250 L');
    expect(html).toContain('INC-2026-0101');
  });

  it('omet les sections des contrats non détenus (superviseur passif seul)', () => {
    const html = normal(rendreEmail({ ...blocs, solaire: null, depotages: null }, new Date('2026-08-30'), 'HELIOS'));
    expect(html).toContain('Maintenance passive / active');
    expect(html).not.toContain('Maintenance solaire');
    expect(html).not.toContain('Carburant');
  });
});
