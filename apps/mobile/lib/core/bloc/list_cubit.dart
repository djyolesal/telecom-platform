import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

enum ResourceStatus { initial, loading, success, failure }

typedef Loader<T> = Future<List<T>> Function();

/// État générique d'une liste chargée depuis le réseau/cache.
class ListState<T> extends Equatable {
  final ResourceStatus status;
  final List<T> items;
  final String? error;

  const ListState({this.status = ResourceStatus.initial, this.items = const [], this.error});

  ListState<T> copyWith({ResourceStatus? status, List<T>? items, String? error}) =>
      ListState<T>(status: status ?? this.status, items: items ?? this.items, error: error);

  @override
  List<Object?> get props => [status, items, error];
}

/// Cubit générique réutilisable pour les écrans de liste.
class ListCubit<T> extends Cubit<ListState<T>> {
  ListCubit() : super(ListState<T>());

  Future<void> run(Loader<T> loader) async {
    emit(state.copyWith(status: ResourceStatus.loading, error: null));
    try {
      final items = await loader();
      emit(state.copyWith(status: ResourceStatus.success, items: items));
    } catch (e) {
      emit(state.copyWith(status: ResourceStatus.failure, error: e.toString()));
    }
  }
}
