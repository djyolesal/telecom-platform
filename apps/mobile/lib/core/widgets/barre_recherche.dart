import 'dart:async';
import 'package:flutter/material.dart';

/// Champ de recherche standard des listes longues : debounce de 400 ms,
/// croix d'effacement, prêt à poser en `bottom:` d'AppBar.
class BarreRecherche extends StatefulWidget implements PreferredSizeWidget {
  final String hint;
  final ValueChanged<String> onChanged;
  const BarreRecherche({super.key, required this.hint, required this.onChanged});

  @override
  Size get preferredSize => const Size.fromHeight(56);

  @override
  State<BarreRecherche> createState() => _BarreRechercheState();
}

class _BarreRechercheState extends State<BarreRecherche> {
  final _ctrl = TextEditingController();
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _ctrl.dispose();
    super.dispose();
  }

  void _onChanged(String v) {
    setState(() {}); // rafraîchit la croix d'effacement
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      if (mounted) widget.onChanged(v.trim());
    });
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      child: TextField(
        controller: _ctrl,
        onChanged: _onChanged,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          hintText: widget.hint,
          prefixIcon: const Icon(Icons.search),
          suffixIcon: _ctrl.text.isNotEmpty
              ? IconButton(
                  icon: const Icon(Icons.clear),
                  onPressed: () {
                    _ctrl.clear();
                    _debounce?.cancel();
                    setState(() {});
                    widget.onChanged('');
                  },
                )
              : null,
          isDense: true,
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
        ),
      ),
    );
  }
}
