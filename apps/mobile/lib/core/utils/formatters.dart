import 'package:intl/intl.dart';

final _date = DateFormat('dd/MM/yyyy', 'fr');
final _dateTime = DateFormat('dd/MM/yyyy HH:mm', 'fr');
final _number = NumberFormat.decimalPattern('fr');

String fmtDate(DateTime? d) => d == null ? '—' : _date.format(d.toLocal());
String fmtDateTime(DateTime? d) => d == null ? '—' : _dateTime.format(d.toLocal());

String fmtDateStr(String? iso) {
  if (iso == null) return '—';
  final d = DateTime.tryParse(iso);
  return d == null ? '—' : _date.format(d.toLocal());
}

String fmtNum(num? n) => n == null ? '—' : _number.format(n);
String fmtFcfa(num? n) => n == null ? '—' : '${_number.format(n)} FCFA';
String fmtLitres(num? n) => n == null ? '—' : '${_number.format(n)} L';
