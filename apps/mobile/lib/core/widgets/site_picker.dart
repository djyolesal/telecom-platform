import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../features/sites/data/site_model.dart';
import '../../features/sites/data/site_repository.dart';

/// Sélecteur de site (chargé depuis le cache/API) pour les formulaires terrain.
class SitePicker extends StatefulWidget {
  final String? initialSiteId;
  final ValueChanged<String?> onChanged;
  const SitePicker({super.key, this.initialSiteId, required this.onChanged});

  @override
  State<SitePicker> createState() => _SitePickerState();
}

class _SitePickerState extends State<SitePicker> {
  late Future<List<Site>> _future;
  String? _value;

  @override
  void initState() {
    super.initState();
    _value = widget.initialSiteId;
    _future = context.read<SiteRepository>().getSites();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Site>>(
      future: _future,
      builder: (context, snap) {
        final sites = snap.data ?? [];
        // Évite l'assertion Dropdown : la valeur doit exister dans les items.
        final value = sites.any((s) => s.id == _value) ? _value : null;
        return DropdownButtonFormField<String>(
          initialValue: value,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Site *', prefixIcon: Icon(Icons.cell_tower)),
          items: sites
              .map((s) => DropdownMenuItem(value: s.id, child: Text('${s.code} — ${s.nom}', overflow: TextOverflow.ellipsis)))
              .toList(),
          validator: (v) => v == null ? 'Site requis' : null,
          onChanged: (v) {
            setState(() => _value = v);
            widget.onChanged(v);
          },
        );
      },
    );
  }
}
