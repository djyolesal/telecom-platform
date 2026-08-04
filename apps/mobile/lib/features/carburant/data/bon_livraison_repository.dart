import 'dart:io';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';
import '../../../core/network/dio_client.dart';
import '../../../core/network/network_info.dart';
import '../../../core/sync/sync_service.dart';
import 'depotage_model.dart';

/// Champs extraits d'un BL par l'analyse serveur (OCR) — tous optionnels :
/// l'OCR propose, le transporteur relit et corrige avant d'enregistrer.
class BlExtrait {
  final String? numeroBL;
  final String? bcNumero;
  final String? dateBL; // date de la ligne « Référence » (JJ/MM/AAAA)
  final String? dateTraitement; // date après le n° de BC (JJ/MM/AAAA)
  final String? immatriculation;
  final int? volumeChargeLitres;
  final List<String> avertissements;

  const BlExtrait({this.numeroBL, this.bcNumero, this.dateBL, this.dateTraitement, this.immatriculation, this.volumeChargeLitres, this.avertissements = const []});

  factory BlExtrait.fromJson(Map<String, dynamic> j) => BlExtrait(
        numeroBL: j['numeroBL'] as String?,
        bcNumero: j['bcNumero'] as String?,
        dateBL: j['dateBL'] as String?,
        dateTraitement: j['dateTraitement'] as String?,
        immatriculation: j['immatriculation'] as String?,
        volumeChargeLitres: (j['volumeChargeLitres'] as num?)?.toInt(),
        avertissements: ((j['avertissements'] as List?) ?? const []).map((e) => e.toString()).toList(),
      );

  static DateTime? _parse(String? d) {
    if (d == null || d.length != 10) return null;
    return DateTime.tryParse('${d.substring(6)}-${d.substring(3, 5)}-${d.substring(0, 2)}');
  }

  /// Date de TRAITEMENT du BL (celle qui suit le n° de bon de commande).
  DateTime? get traitement => _parse(dateTraitement);
}

class AnalyseBlResult {
  final List<BlExtrait> documents;
  /// BC reconnus en base, indexés par numéro (PO…) — pour présélectionner.
  final Map<String, BonCommandeLite> bcs;
  const AnalyseBlResult({required this.documents, required this.bcs});
}

/// Saisie des bons de livraison par le transporteur (offline-first).
class BonLivraisonRepository {
  final DioClient _client;
  final NetworkInfo _network;
  final SyncService _sync;

  BonLivraisonRepository(this._client, this._network, this._sync);

  /// Bons de commande disponibles pour rattacher un nouveau bon de livraison.
  Future<List<BonCommandeLite>> getBonsCommande() async {
    if (!await _network.isConnected) return [];
    return _client.request(
      (dio) => dio.get('/bons-commande', queryParameters: {'limit': 50}),
      (data) => (data['data'] as List).map((e) => BonCommandeLite.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  /// Mes chargements (l'API filtre déjà sur le prestataire du compte).
  Future<List<BonLivraisonLite>> getMesBonsLivraison() async {
    return _client.request(
      (dio) => dio.get('/bons-livraison', queryParameters: {'limit': 50}),
      (data) => (data['data'] as List)
          .map((e) => BonLivraisonLite.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  /// Détail d'un chargement + son plan de livraison (sites et volumes).
  Future<BonLivraisonDetail> getBonLivraison(String id) async {
    return _client.request(
      (dio) => dio.get('/bons-livraison/$id'),
      (data) => BonLivraisonDetail.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// Télécharge le plan de livraison en PDF (requête AUTHENTIFIÉE : l'endpoint
  /// vérifie que le BL appartient bien au transporteur) et renvoie le chemin du
  /// fichier écrit sur l'appareil, prêt à être ouvert ou partagé.
  Future<String> telechargerPlanPdf(String id, String numeroBL) async {
    final octets = await _client.request<List<int>>(
      (dio) => dio.get<List<int>>(
        '/bons-livraison/$id/plan.pdf',
        options: Options(responseType: ResponseType.bytes),
      ),
      (data) => (data as List).cast<int>(),
    );
    final dossier = await getTemporaryDirectory();
    final fichier = File('${dossier.path}/plan-livraison-${numeroBL.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_')}.pdf');
    await fichier.writeAsBytes(octets, flush: true);
    return fichier.path;
  }

  /// Date calendaire « AAAA-MM-JJ » (pas d'heure, pas de fuseau).
  static String _dateSeule(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  /// Envoie la PHOTO du BL à l'analyse serveur (OCR) pour pré-remplir le
  /// formulaire. Renvoie `null` hors-ligne (saisie manuelle, photo conservée).
  Future<AnalyseBlResult?> analyserPhoto(Uint8List bytes) async {
    if (!await _network.isConnected) return null;
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(bytes, filename: 'bl-scan.jpg'),
    });
    return _client.request(
      (dio) => dio.post('/bons-livraison/analyser-document', data: form),
      (data) {
        final d = data['data'] as Map<String, dynamic>;
        final bcs = <String, BonCommandeLite>{};
        (d['bcs'] as Map<String, dynamic>? ?? const {}).forEach((numero, v) {
          final m = v as Map<String, dynamic>;
          bcs[numero] = BonCommandeLite(
            id: m['id'] as String,
            numero: m['numero'] as String,
            annee: (m['annee'] as num).toInt(),
            trimestre: (m['trimestre'] as num).toInt(),
            mois: ((m['mois'] as List?) ?? const []).map((e) => (e as num).toInt()).toList(),
          );
        });
        return AnalyseBlResult(
          documents: ((d['documents'] as List?) ?? const []).map((e) => BlExtrait.fromJson(e as Map<String, dynamic>)).toList(),
          bcs: bcs,
        );
      },
    );
  }

  /// Crée un bon de livraison. Les photos des documents (BL, bordereau) sont des
  /// chemins LOCAUX uploadés par la sync, dont la clé alimente blPdfPath / bordereauPdfPath.
  Future<SubmitResult> create({
    required String bonCommandeId,
    required String numeroBL,
    required int mois,
    required int annee,
    required String immatriculation,
    required double volumeChargeLitres,
    required DateTime dateChargement,
    DateTime? dateTraitement,
    String? observations,
    String? blDocLocalPath,
    String? bordereauDocLocalPath,
  }) {
    final attachments = <Map<String, String>>[
      if (blDocLocalPath != null) {'path': blDocLocalPath, 'kind': 'photo', 'field': 'blPdfPath', 'folder': 'documents'},
      if (bordereauDocLocalPath != null) {'path': bordereauDocLocalPath, 'kind': 'photo', 'field': 'bordereauPdfPath', 'folder': 'documents'},
    ];
    return _sync.submit(
      endpoint: '/bons-livraison',
      entityType: 'bon_livraison',
      payload: {
        'bonCommandeId': bonCommandeId,
        'numeroBL': numeroBL,
        'mois': mois,
        'annee': annee,
        'immatriculation': immatriculation,
        'volumeChargeLitres': volumeChargeLitres,
        // Dates CALENDAIRES (choisies par un date-picker à minuit local) : on
        // envoie la date pure « AAAA-MM-JJ », jamais un instant converti en UTC.
        // En UTC+1, minuit local → 23:00 UTC la veille → jour de chargement
        // faux d'un cran côté serveur. La date pure préserve le jour partout.
        'dateChargement': _dateSeule(dateChargement),
        if (dateTraitement != null) 'dateTraitement': _dateSeule(dateTraitement),
        if (observations != null && observations.isNotEmpty) 'observations': observations,
      },
      attachments: attachments,
    );
  }
}
