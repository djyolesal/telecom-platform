import 'package:flutter_test/flutter_test.dart';
import 'package:telecom_mobile/core/config/app_config.dart';
import 'package:telecom_mobile/features/maintenance/data/maintenance_model.dart';

void main() {
  setUp(() {
    AppConfig.minDureeClotureMin = 60;
    AppConfig.dureesMinTaches = const {'desherbage': 20, 'clim': 120, 'serrures': 0};
  });

  test('durée propre à la tâche, sinon durée globale', () {
    expect(AppConfig.dureeMinCloture('desherbage'), 20);
    expect(AppConfig.dureeMinCloture('clim'), 120);
    expect(AppConfig.dureeMinCloture('serrures'), 0);
    expect(AppConfig.dureeMinCloture('extincteurs'), 60);
    expect(AppConfig.dureeMinCloture(null), 60);
  });

  test('la maintenance porte sa clé de tâche (null pour une curative)', () {
    Map<String, dynamic> j(String? key) => {
          'id': 'm1', 'type': 'PREVENTIVE', 'categorie': 'AUTRE', 'equipement': 'Site',
          'statut': 'EN_COURS', 'datePlanifiee': '2026-10-13T08:00:00.000Z',
          'tachePreventiveKey': key,
        };
    expect(Maintenance.fromJson(j('clim')).tachePreventiveKey, 'clim');
    expect(Maintenance.fromJson(j(null)).tachePreventiveKey, isNull);
  });
}
