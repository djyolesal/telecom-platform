import { signeMouvement } from './mouvementsCarburant.service';

describe('signeMouvement', () => {
  it('sort le carburant du site pour une sortie de transfert et une purge', () => {
    // Le SENS vient du TYPE, jamais du signe du volume (toujours positif en
    // base) : un signe inversé à la saisie fausserait tous les cumuls.
    expect(signeMouvement('TRANSFERT_SORTIE')).toBe(-1);
    expect(signeMouvement('PURGE')).toBe(-1);
  });
  it('fait entrer le carburant sur le site receveur', () => {
    expect(signeMouvement('TRANSFERT_ENTREE')).toBe(1);
  });
  it('laisse le stock des sites intact pour un avoir fournisseur', () => {
    // L'avoir crédite un bon de commande : il ne touche aucune cuve.
    expect(signeMouvement('AVOIR_FOURNISSEUR')).toBe(0);
  });
  it('est neutre pour un type inconnu', () => {
    expect(signeMouvement('AUTRE_CHOSE')).toBe(0);
  });
  it('rend un transfert neutre au bilan du parc', () => {
    expect(signeMouvement('TRANSFERT_SORTIE') + signeMouvement('TRANSFERT_ENTREE')).toBe(0);
  });
});
