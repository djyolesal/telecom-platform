import { generateIncidentPdf, unionMinutes, duree } from './pdf.service';

const d = (iso: string) => new Date(iso);
const c = (debut: string, fin: string | null) => ({ dateDebut: d(debut), dateFin: fin ? d(fin) : null });

describe('indisponibilité d’un site : réunion des coupures, jamais leur somme', () => {
  // DEUX TECHNOLOGIES TOMBÉES ENSEMBLE ne font pas deux fois la panne. Ce
  // chiffre se compare aux seuils réglementaires : l'additionner gonflerait
  // l'indisponibilité déclarée d'un facteur égal au nombre de technologies
  // suivies sur le site.
  it('deux coupures simultanées de 4 h font 4 h, pas 8', () => {
    expect(unionMinutes([
      c('2026-09-14T04:00:00Z', '2026-09-14T08:00:00Z'),
      c('2026-09-14T04:00:00Z', '2026-09-14T08:00:00Z'),
    ])).toBe(240);
  });

  it('deux coupures disjointes s’additionnent bien', () => {
    expect(unionMinutes([
      c('2026-09-14T04:00:00Z', '2026-09-14T06:00:00Z'),
      c('2026-09-14T10:00:00Z', '2026-09-14T13:00:00Z'),
    ])).toBe(300);
  });

  it('chevauchement partiel : de la première ouverture à la dernière fermeture', () => {
    expect(unionMinutes([
      c('2026-09-14T04:00:00Z', '2026-09-14T07:00:00Z'),
      c('2026-09-14T06:00:00Z', '2026-09-14T09:00:00Z'),
    ])).toBe(300);
  });

  it('coupure contenue dans une autre : la plus longue fait foi', () => {
    expect(unionMinutes([
      c('2026-09-14T04:00:00Z', '2026-09-14T12:00:00Z'),
      c('2026-09-14T06:00:00Z', '2026-09-14T07:00:00Z'),
    ])).toBe(480);
  });

  it('coupures rendues dans le désordre : le tri est fait', () => {
    expect(unionMinutes([
      c('2026-09-14T10:00:00Z', '2026-09-14T11:00:00Z'),
      c('2026-09-14T04:00:00Z', '2026-09-14T05:00:00Z'),
    ])).toBe(120);
  });

  it('une coupure encore ouverte ne se chiffre pas : on ne devine pas sa fin', () => {
    expect(unionMinutes([c('2026-09-14T04:00:00Z', null)])).toBeNull();
    expect(unionMinutes([
      c('2026-09-14T04:00:00Z', '2026-09-14T08:00:00Z'),
      c('2026-09-14T10:00:00Z', null),
    ])).toBeNull();
  });

  it('aucune coupure : rien à chiffrer', () => {
    expect(unionMinutes([])).toBeNull();
  });
});

describe('durées lisibles', () => {
  it('minutes, heures, jours', () => {
    expect(duree(45)).toBe('45 min');
    expect(duree(60)).toBe('1 h');
    expect(duree(155)).toBe('2 h 35');
    expect(duree(458)).toBe('7 h 38');
    expect(duree(3000)).toBe('2 j 2 h');
  });

  it('absente plutôt qu’inventée à zéro', () => {
    expect(duree(null)).toBe('-');
    expect(duree(undefined)).toBe('-');
  });
});

describe('rendu du rapport', () => {
  const base = {
    id: 'abc12345', reference: 'INC-2026-00112',
    type: 'ENERGIE', severite: 'CRITIQUE', statut: 'RESOLU',
    description: 'Coupure totale du site.',
    dateOuverture: d('2026-09-14T04:12:00Z'),
    site: { code: 'LOME7-12', nom: 'ADAKPAME', region: 'Lomé & Golfe' },
  };

  it('produit un PDF valide', async () => {
    const buf = await generateIncidentPdf(base);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('se rend aussi sur un incident ouvert, sans date de résolution', async () => {
    // Le document doit exister à tout moment de la vie de l'incident : c'est
    // souvent AVANT la résolution qu'on a besoin de le transmettre.
    const buf = await generateIncidentPdf({ ...base, statut: 'OUVERT', dateResolution: null });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('se rend avec coupures, curatives et agent de sécurité', async () => {
    const buf = await generateIncidentPdf({
      ...base,
      dateIntervention: d('2026-09-14T07:35:00Z'),
      dateResolution: d('2026-09-14T11:50:00Z'),
      delaiMaxHeures: 24,
      nomAgentSecurite: 'Komla LAWSON',
      coupures: [{ technologie: '2G', ...c('2026-09-14T04:12:00Z', '2026-09-14T11:50:00Z'), downtimeMinutes: 458 }],
      curatives: [{ reference: 'MNT-2026-04471', equipement: 'GE 22 kVA', statut: 'TERMINEE' }],
    });
    expect(buf.length).toBeGreaterThan(2000);
  });
});
