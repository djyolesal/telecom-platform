# Appro carburant — état du cycle et plan de bouclage (04/08/2026)

Revue complète du volet carburant : cycle de bout en bout + suivi chauffeurs/camions.
Chaque constat retenu a été **vérifié dans le code** (fichier:ligne).

**En une phrase** : la chaîne **physique** (BC → BL → plan → dépotage → réconciliation →
alertes) est complète et sérieusement instrumentée ; c'est la chaîne **comptable** qui
manque — des portes de sortie non modélisées, des statuts qui ne pilotent rien, et aucun
rapprochement où commandé / chargé / livré / consommé / perdu s'additionnent enfin.

---

## 1. Ce qui fonctionne déjà (à ne pas refaire)

BC trimestriel avec PDF signé obligatoire · volumes mensuels · BL avec document + bordereau
obligatoires · contrôle bloquant Σ plan = volume chargé · plan de livraison préservant les
dépotages · dépotage terrain complet (jauge avant/après, ≥ 6 photos, 3 signatures, heures GE,
GPS, idempotence) · réconciliation automatique sous verrou par site (écart livraison + écart
conso) · statut de ligne recalculé à chaque dépotage · manquants à 4 niveaux + alerte
quotidienne avec escalade · détection d'anomalies par site · réappro prédictif et tournées ·
corrélation livré/consommé.

---

## 2. Les failles vérifiées, par gravité

### 🔴 F1. Un transporteur peut effacer son propre manquant
`carburantLogistique.controller.ts` — `if (statut != null) data.statut = statut;` **sans aucun
contrôle de rôle** (les gardes `isTransporteur` ne couvrent que le numéro, le transporteur et
le plan).

Or les rapports filtrent `statut: { not: 'ANNULE' }`. Un transporteur passe son BL à ANNULE :
le chargé **et** le manquant disparaissent des 4 niveaux de rapport et de l'alerte quotidienne,
alors que les dépotages restent comptés dans le stock. La suppression est protégée quand des
dépotages existent — l'annulation ne l'est pas.

### 🔴 F2. Un dépotage « hors plan » est un cul-de-sac définitif
Le mobile propose « Hors plan (aucune) » et l'API accepte `ligneLivraisonId: null`. Mais la
liste blanche de `updateDepotage` **ne contient ni `ligneLivraisonId` ni `volumeAnnonceLitres`**
(vérifié), et aucune route ne permet de rattacher après coup.

Conséquence : le carburant est en cuve, mais la ligne du plan reste PRÉVU → le site sort en
manquant critique **chaque nuit**, le BL n'est jamais soldé, et le seul remède est la
suppression du dépotage (ADMIN), qui détruit 6 photos et 3 signatures.

### 🔴 F3. Le reste en citerne n'est jamais tracé
Le « reste » est calculé et affiché à un seul endroit, sans aucun champ ni décision derrière.
800 L rentrés au dépôt restent un manquant camion perpétuel — **rien ne distingue un retour
dépôt d'un siphonnage**, et le seul moyen de faire taire l'alerte est l'annulation (cf. F1),
qui efface aussi les milliers de litres réellement livrés.

### 🟠 F4. Le rapport direction affiche « Coût total : 0 FCFA »
`Depotage.coutTotal` n'est **jamais écrit** (vérifié : aucune écriture), alors qu'il est sommé
dans le rapport mensuel et imprimé dans le PDF envoyé à la direction.

### 🟠 F5. La colonne « Livré » du bon de commande affiche le volume CHARGÉ
L'écran BC titre « Livré (L) » mais la valeur vient de `charge.get(mois)`, construite sur
`volumeChargeLitres` — ce qui est monté dans le camion, pas ce qui est descendu sur les sites.
Le manager pilote son trimestre sur un chiffre mal nommé.

### 🟠 F6. Aucun geofencing sur le dépotage
`assertOnSite` est appliqué aux incidents (2×) et aux maintenances (3×), **jamais au dépotage**
(vérifié). Le GPS est stocké et jamais confronté au site. Un dépotage fabriqué depuis Lomé pour
un site de Dapaong est indiscernable — sur l'opération qui engage le plus de valeur.

### 🟠 F7. Trois vérités de stock coexistent
Le tableau de bord et la page Stock ignorent les dépotages (relevés seuls) ; le job d'alerte de
8 h et le réappro, eux, les intègrent. Le même matin, un site peut être « CRITIQUE à 300 L »
sur un écran et hors liste sur l'autre.

### 🟠 F8. Le statut d'un BL et celui d'un BC ne pilotent rien
Aucun code ne fait avancer `BonLivraison.statut` : un camion entièrement livré reste
« PLANIFIÉ ». `BonCommande.statut` n'a **aucun effet fonctionnel** : un BL retardataire saisi en
mai repeuple un T1 déjà facturé, et annuler un BC ne retire pas ses BL des manquants.

### 🟡 F9. Le « volume annoncé » mesure deux choses différentes
Le mobile pré-remplit l'annoncé avec le volume **du plan**, mais la réconciliation en tire
l'écart de livraison, que la détection d'anomalies interprète comme « facturé mais non entré en
cuve » = détournement. Un chauffeur qui annonce honnêtement 2 500 L sur un plan de 3 000 crée un
faux signal de vol ; un vrai détournement passe pour un écart de plan.

### 🟡 F10. Angles morts d'exploitation
Sur-livraison invisible (`Math.max(0, …)` partout) · BL chargé sans plan jamais listé ·
brouillons oubliés invisibles pour toujours · transfert de gasoil entre sites impossible (il faut
inventer un faux dépotage, qui déclenche une fausse alerte de vol sur le site donneur) · aucun
avoir/reprise fournisseur (volumes négatifs interdits) · purge/vidange de cuve comptée comme
surconsommation · deux passages du même camion sur un site interdits par une contrainte d'unicité.

---

## 3. Suivi chauffeurs et camions : quasi inexistant

**Aucune entité `Chauffeur` ni `Vehicule`** (vérifié : zéro dans le schéma).

- `nomChauffeur` : texte libre, **2 usages dans tout le code** — une écriture, une lecture pour
  l'étiquette du bordereau PDF. Jamais dans un export, un écran, un rapport ou une anomalie.
- **La signature du chauffeur est bloquante, son nom ne l'est pas** (vérifié) : on exige une
  signature manuscrite sans exiger de savoir qui signe. En litige, elle ne vaut rien.
- `immatriculation` : obligatoire mais **non indexée**, sans référentiel, avec **deux graphies
  natives** (l'OCR produit `TG 1234 AB`, l'interface suggère `TG-1234-AB`) et la sentinelle
  `À AFFECTER` des brouillons.
- La détection de vol est dimensionnée **par site uniquement**. L'écart de livraison, pourtant
  structurellement imputable au **transport**, accuse aujourd'hui le site — donc le technicien.

Sans réponse possible : « qui conduisait ce chargement ? », « ce chauffeur livre-t-il
systématiquement moins ? », « ce camion a-t-il des manquants récurrents ? », « quelle
performance comparée des transporteurs ? ».

---

## 4. Le bouclage : peut-on répondre à la question ?

**Non.** Sur les cinq chiffres du trimestre : *commandé* et *chargé* sont bons (le chargé fuit
si un BL est annulé, cf. F1) ; *livré* est **sous-estimé** (exclut les hors-plan, F2) ;
*consommé* n'existe pas par trimestre ni par BC ; *perdu* n'est jamais consolidé (deux mesures
dans deux écrans, jamais additionnées).

Et l'équation de conservation — `stock_début + livré − consommé = stock_fin + pertes` — **n'est
écrite nulle part**. La corrélation existante compare livré et consommé en ignorant
volontairement les stocks de début et de fin : un site dont la cuve s'est vidée de 5 000 L sur
la période ressort « normal ».

---

## 5. Plan proposé

### Lot 1 — Étanchéité (effort faible, gain immédiat)
1. **Verrouiller l'annulation d'un BL** : interdite si des dépotages sont rattachés, réservée
   MANAGER/ADMIN, motif obligatoire. *(F1 — à faire en premier, c'est une faille de contrôle.)*
2. **Rattacher/corriger un dépotage** : étendre l'édition à `ligneLivraisonId` et
   `volumeAnnonceLitres`, avec recalcul de la réconciliation et des deux lignes concernées. *(F2)*
3. **Calculer `coutTotal`** à la création et à l'édition + rattrapage de l'existant. *(F4)*
4. **Geofencing du dépotage**, aligné sur les incidents. *(F6)*
5. **Source de stock unique** consommée par tous les écrans. *(F7)*
6. **Renommer « Livré » en « Chargé »** sur l'écran BC et ajouter la vraie colonne livrée. *(F5)*

### Lot 2 — Pilotage des états (effort faible/moyen)
7. Statut BL dérivé automatiquement (PLANIFIÉ → CHARGÉ → LIVRÉ). *(F8)*
8. BC clôturé/annulé réellement opposable (refus de BL, propagation aux manquants, garde sur la
   baisse d'un volume mensuel sous le déjà-chargé). *(F8)*
9. KPI « BL sans plan depuis N jours » et « brouillons oubliés », intégrés à l'alerte de 9 h.
10. Statut et colonne « sur-livré ». *(F10)*

### Lot 3 — Bouclage comptable (effort moyen — le cœur de la demande)
11. **Clôture d'un BL avec ventilation du reste** : retour dépôt / perte constatée / report sur
    le BL suivant, avec bon de retour signé. *C'est le geste qui manque pour solder un camion.* *(F3)*
12. **Rapport de rapprochement trimestriel par BC** : une ligne par mois, colonnes
    `commandé | chargé | planifié | livré (dont hors plan) | retour dépôt | consommé | écart non
    expliqué`, avec l'équation de conservation par site agrégée au trimestre. *L'artefact qui
    répond à la question en une page.*
13. Séparer « volume annoncé par le chauffeur » de « volume prévu au plan ». *(F9)*

### Lot 4 — Chauffeurs et camions (effort moyen)
14. **Référentiel véhicule** + normalisation de plaque (prérequis de toute agrégation) et
    contrôle « volume chargé > capacité citerne ».
15. **Chauffeur déclaré sur le BL** (avant le départ dépôt) — plus fort levier anti-fraude pour
    l'effort le plus faible : chauffeur déclaré ≠ chauffeur signataire devient une anomalie.
16. **Référentiel chauffeur** rattaché au transporteur, sélection au lieu de la saisie libre, et
    nom rendu obligatoire au même titre que la signature.
17. Projeter la détection d'anomalies et les manquants sur les axes **chauffeur** et **véhicule**.
18. Colonnes chauffeur/camion dans les exports et écrans de dépotage.

### Lot 5 — Cas d'exploitation manquants (effort moyen)
19. Transfert de gasoil entre sites (mouvement à deux jambes, neutre au bilan).
20. Avoir / reprise fournisseur (volume négatif tracé).
21. Événement « purge / vidange de cuve » exclu du calcul de surconsommation.
22. Autoriser deux passages du même camion sur un même site.
