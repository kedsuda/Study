<?php

namespace App\Support;

final class ThaiText
{
    public static function repair(string $text, string $context = ''): string
    {
        // Legacy keyword extraction could truncate the last mojibake byte.
        // Restore only when the question contains exactly one matching word.
        if ($context !== '' && preg_match('/à[¸¹]/u', $text) === 1) {
            preg_match_all('/\p{Thai}+/u', self::repair($context), $words);
            $matches = [];
            foreach (array_unique($words[0]) as $word) {
                foreach (['Windows-1252', 'ISO-8859-1'] as $encoding) {
                    $encoded = mb_convert_encoding($word, 'UTF-8', $encoding);
                    $missing = mb_strlen($encoded) - mb_strlen($text);
                    if ($missing > 0 && $missing <= 2 && str_starts_with($encoded, $text)) {
                        $matches[$word] = $word;
                    }
                }
            }
            if (count($matches) === 1) {
                return reset($matches);
            }
        }
        // Repair only reversible byte sequences, preserving surrounding Thai text.
        for ($pass = 0; $pass < 3; $pass++) {
            $repaired = preg_replace_callback(
                '/[\x{0080}-\x{00FF}\x{0152}\x{0153}\x{0160}\x{0161}\x{0178}\x{017D}\x{017E}\x{0192}\x{02C6}\x{02DC}\x{2013}-\x{201A}\x{201C}-\x{201E}\x{2020}-\x{2022}\x{2026}\x{2030}\x{2039}\x{203A}\x{20AC}\x{2122}]+/u',
                static function (array $match): string {
                    foreach (['Windows-1252', 'ISO-8859-1'] as $encoding) {
                        $bytes = mb_convert_encoding($match[0], $encoding, 'UTF-8');
                        if (mb_convert_encoding($bytes, 'UTF-8', $encoding) !== $match[0]
                            || ! mb_check_encoding($bytes, 'UTF-8')) {
                            continue;
                        }

                        if (preg_match('/\p{Thai}|à[¸¹]|Ã/u', $bytes) === 1) {
                            return $bytes;
                        }
                    }

                    return $match[0];
                },
                $text
            ) ?? $text;

            if ($repaired === $text) {
                break;
            }
            $text = $repaired;
        }

        return $text;
    }
}
