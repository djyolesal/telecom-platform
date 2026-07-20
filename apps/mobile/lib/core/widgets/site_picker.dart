import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../features/sites/data/site_model.dart';
import '../../features/sites/data/site_repository.dart';

/// Sélecteur de site avec recherche (liste chargée depuis le cache/API).
class SitePicker extends StatefulWidget {
  final String? initialSiteId;
  final ValueChanged<String?> onChanged;
  const SitePicker({super.key, this.initialSiteId, required this.onChanged});

  @override
  State<SitePicker> createState() => _SitePickerState();
}

class _SitePickerState extends State<SitePicker> {
  List<Site> _sites = [];
  Site? _selected;
  String? _value;

  @override
  void initState() {
    super.initState();
    _value = widget.initialSiteId;
    _load();
  }

  Future<void> _load() async {
    final sites = await context.read<SiteRepository>().getSites();
    if (!mounted) return;
    Site? sel;
    for (final s in sites) {
      if (s.id == _value) { sel = s; break; }
    }
    setState(() { _sites = sites; _selected = sel; });
  }

  @override
  Widget build(BuildContext context) {
    return FormField<String>(
      initialValue: _value,
      validator: (v) => (v == null || v.isEmpty) ? 'Site requis' : null,
      builder: (field) => InkWell(
        onTap: _sites.isEmpty
            ? null
            : () async {
                final picked = await showModalBottomSheet<Site>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => _SiteSearchSheet(sites: _sites),
                );
                if (picked != null) {
                  setState(() { _selected = picked; _value = picked.id; });
                  field.didChange(picked.id);
                  widget.onChanged(picked.id);
                }
              },
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: 'Site *',
            prefixIcon: const Icon(Icons.cell_tower),
            suffixIcon: const Icon(Icons.search),
            errorText: field.errorText,
          ),
          child: Text(
            _selected != null ? _selected!.nom : (_sites.isEmpty ? 'Chargement…' : 'Rechercher un site…'),
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: _selected != null ? null : Colors.grey.shade500),
          ),
        ),
      ),
    );
  }
}

/// Feuille de recherche : champ texte + liste filtrée (code/nom/région).
class _SiteSearchSheet extends StatefulWidget {
  final List<Site> sites;
  const _SiteSearchSheet({required this.sites});

  @override
  State<_SiteSearchSheet> createState() => _SiteSearchSheetState();
}

class _SiteSearchSheetState extends State<_SiteSearchSheet> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final q = _q.trim().toLowerCase();
    final filtered = q.isEmpty
        ? widget.sites
        : widget.sites
            .where((s) =>
                s.nom.toLowerCase().contains(q) ||
                s.region.toLowerCase().contains(q))
            .toList();

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        maxChildSize: 0.9,
        builder: (context, scrollController) => Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: TextField(
                autofocus: true,
                decoration: const InputDecoration(
                  hintText: 'Rechercher un site (nom, région)…',
                  prefixIcon: Icon(Icons.search),
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                onChanged: (v) => setState(() => _q = v),
              ),
            ),
            Expanded(
              child: filtered.isEmpty
                  ? const Center(child: Text('Aucun résultat'))
                  : ListView.separated(
                      controller: scrollController,
                      itemCount: filtered.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (_, i) {
                        final s = filtered[i];
                        return ListTile(
                          title: Text(s.nom, style: const TextStyle(fontWeight: FontWeight.w600)),
                          subtitle: Text(s.region),
                          onTap: () => Navigator.pop(context, s),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
