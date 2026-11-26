export interface EncodingOption {
  value: string;
  label: string;
}

export const DEFAULT_ENCODING = 'utf-8';

export const ENCODING_OPTIONS: EncodingOption[] = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'euc-kr', label: 'EUC-KR / CP949 (한국어)' },
  { value: 'shift_jis', label: 'Shift_JIS (일본어)' },
  { value: 'euc-jp', label: 'EUC-JP (일본어)' },
  { value: 'gbk', label: 'GBK / CP936 (중국어 간체)' },
  { value: 'gb18030', label: 'GB18030 (중국어 간체)' },
  { value: 'big5', label: 'Big5 (중국어 번체)' },
  { value: 'windows-1252', label: 'Windows-1252 / Latin-1 (서유럽)' },
  { value: 'iso-8859-2', label: 'ISO-8859-2 (중앙유럽)' },
  { value: 'windows-1251', label: 'Windows-1251 (키릴)' },
  { value: 'koi8-r', label: 'KOI8-R (러시아어)' },
];
