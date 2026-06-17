import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';

/// Grille d'aperçus de photos. Au clic, ouvre la visionneuse plein écran
/// (défilement horizontal + zoom).
class PhotoThumbnails extends StatelessWidget {
  final List<String> urls;
  final double size;
  const PhotoThumbnails({super.key, required this.urls, this.size = 76});

  void _open(BuildContext context, int index) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => PhotoViewerScreen(urls: urls, initialIndex: index)),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (urls.isEmpty) return const SizedBox.shrink();
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: List.generate(urls.length, (i) {
        return GestureDetector(
          onTap: () => _open(context, i),
          child: Hero(
            tag: 'photo_${urls[i]}',
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: CachedNetworkImage(
                imageUrl: urls[i],
                width: size,
                height: size,
                fit: BoxFit.cover,
                placeholder: (_, __) => Container(
                  width: size,
                  height: size,
                  color: Colors.grey.shade200,
                  child: const Center(child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))),
                ),
                errorWidget: (_, __, ___) => Container(
                  width: size,
                  height: size,
                  color: Colors.grey.shade200,
                  child: const Icon(Icons.broken_image, color: Colors.grey),
                ),
              ),
            ),
          ),
        );
      }),
    );
  }
}

/// Visionneuse plein écran : défilement entre les photos + zoom (pincer/double-tap).
class PhotoViewerScreen extends StatefulWidget {
  final List<String> urls;
  final int initialIndex;
  const PhotoViewerScreen({super.key, required this.urls, this.initialIndex = 0});

  @override
  State<PhotoViewerScreen> createState() => _PhotoViewerScreenState();
}

class _PhotoViewerScreenState extends State<PhotoViewerScreen> {
  late final PageController _controller;
  late int _index;

  @override
  void initState() {
    super.initState();
    _index = widget.initialIndex;
    _controller = PageController(initialPage: widget.initialIndex);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text('${_index + 1} / ${widget.urls.length}', style: const TextStyle(fontSize: 15)),
      ),
      body: PageView.builder(
        controller: _controller,
        itemCount: widget.urls.length,
        onPageChanged: (i) => setState(() => _index = i),
        itemBuilder: (_, i) {
          return Center(
            child: Hero(
              tag: 'photo_${widget.urls[i]}',
              child: InteractiveViewer(
                minScale: 1,
                maxScale: 4,
                child: CachedNetworkImage(
                  imageUrl: widget.urls[i],
                  fit: BoxFit.contain,
                  placeholder: (_, __) => const Center(child: CircularProgressIndicator()),
                  errorWidget: (_, __, ___) => const Icon(Icons.broken_image, color: Colors.white54, size: 48),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
