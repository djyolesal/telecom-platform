import { realisesDansPerimetre, lignesFiche } from './ficheValidation.service';
import { SiteEligibilite } from '../utils/tachesPreventives';

const d = (iso: string) => new Date(iso);

/** Site CEET + GE : la ligne 10 de la fiche (entretien du GE de secours) lui est due. */
const site = (id: string, o: Partial<SiteEligibilite> = {}): SiteEligibilite & { id: string } => ({
  id,
  typePylone: 'GREENFIELD',
  hasClimatiseur: false,
  hasExtincteurs: false,
  powerConfig: 'CEET_GE',
  statutGE: 'GE_SECOURS',
  cuveVolumeLitres: 2000,
  exclusions: [],
  ...o,
});

const faite = (siteId: string, key = 'ge_secours') => ({ siteId, tachePreventiveKey: key });
const finOctobre = d('2026-10-31');

describe('fiche de validation : les réalisés restent dans le périmètre des concernés', () => {
  it('compte les sites distincts, pas les interventions', () => {
    const r = realisesDansPerimetre(
      [faite('s1'), faite('s1'), faite('s2')],
      [site('s1'), site('s2')],
      finOctobre,
    );
    expect(r.ge_secours).toBe(2);
  });

  // Site désactivé depuis, ou rattaché au lot d'un autre contrat : il n'est
  // plus dans le parc de la fiche, son intervention n'y a pas sa place.
  it('écarte une intervention sur un site absent de la fiche', () => {
    const r = realisesDansPerimetre([faite('s1'), faite('inconnu')], [site('s1')], finOctobre);
    expect(r.ge_secours).toBe(1);
  });

  // LE CAS QUI FAISAIT « 13 réalisés sur 11 concernés » : la tâche a été
  // sortie du contrat sur ce site, mais l'intervention avait été faite.
  it('écarte un site dont la tâche est hors contrat à la fin du mois', () => {
    const exclu = site('s2', { exclusions: [{ tacheKey: 'ge_secours', debut: d('2026-10-01'), fin: null }] });
    const sites = [site('s1'), exclu];
    const r = realisesDansPerimetre([faite('s1'), faite('s2')], sites, finOctobre);
    const ligne = lignesFiche({ sites, realisesParKey: r, annee: 2026, mois: 10 })
      .find((l) => l.numero === 10)!;
    expect(ligne.concernes).toBe(1);
    expect(ligne.realises).toBe(1);
  });

  // Une exclusion postérieure au mois de la fiche ne doit pas rétro-amputer un
  // mois déjà signé : les deux colonnes s'apprécient à la même date.
  it('garde le site quand l’exclusion ne commence qu’après le mois', () => {
    const futur = site('s2', { exclusions: [{ tacheKey: 'ge_secours', debut: d('2026-11-01'), fin: null }] });
    const sites = [site('s1'), futur];
    const r = realisesDansPerimetre([faite('s1'), faite('s2')], sites, finOctobre);
    const ligne = lignesFiche({ sites, realisesParKey: r, annee: 2026, mois: 10 })
      .find((l) => l.numero === 10)!;
    expect(ligne.concernes).toBe(2);
    expect(ligne.realises).toBe(2);
  });

  // Site techniquement hors cible : un GE de production (pas de CEET) n'est
  // pas concerné par la ligne « GE de secours », quoi qu'un ticket en dise.
  it('écarte un site que la tâche ne vise pas', () => {
    const production = site('s2', { powerConfig: 'GE_UNIQUEMENT', statutGE: 'GE_PERMANENT' });
    const r = realisesDansPerimetre([faite('s1'), faite('s2')], [site('s1'), production], finOctobre);
    expect(r.ge_secours).toBe(1);
  });

  it('ignore les interventions sans clé de tâche', () => {
    const r = realisesDansPerimetre(
      [{ siteId: 's1', tachePreventiveKey: null }, faite('s1')],
      [site('s1')],
      finOctobre,
    );
    expect(r.ge_secours).toBe(1);
  });

  // Aucune règle de dû à opposer à une clé qui n'est plus au catalogue : on
  // compte, plutôt que de faire disparaître sans trace.
  it('garde une clé inconnue du catalogue', () => {
    const r = realisesDansPerimetre([faite('s1', 'tache_retiree')], [site('s1')], finOctobre);
    expect(r.tache_retiree).toBe(1);
  });
});
