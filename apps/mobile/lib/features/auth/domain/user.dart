import 'dart:convert';
import 'package:equatable/equatable.dart';

/// Utilisateur authentifié.
class User extends Equatable {
  final String id;
  final String nom;
  final String prenom;
  final String email;
  final String role;
  final String? region;

  const User({
    required this.id,
    required this.nom,
    required this.prenom,
    required this.email,
    required this.role,
    this.region,
  });

  String get fullName => '$prenom $nom';
  String get initials => (prenom.isNotEmpty ? prenom[0] : '') + (nom.isNotEmpty ? nom[0] : '');

  factory User.fromJson(Map<String, dynamic> json) => User(
        id: json['id'] as String,
        nom: json['nom'] as String? ?? '',
        prenom: json['prenom'] as String? ?? '',
        email: json['email'] as String? ?? '',
        role: json['role'] as String? ?? 'TECHNICIEN',
        region: json['region'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'nom': nom,
        'prenom': prenom,
        'email': email,
        'role': role,
        'region': region,
      };

  String encode() => jsonEncode(toJson());
  static User decode(String source) => User.fromJson(jsonDecode(source) as Map<String, dynamic>);

  @override
  List<Object?> get props => [id, email, role];
}
