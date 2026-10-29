<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class FileUploadRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // DOCX is a ZIP container.  On some PHP/hosting combinations
            // finfo reports it as application/zip, so Laravel's `mimes` rule
            // incorrectly rejects a valid .docx selected from the browser.
            // This attachment endpoint supports several file families, so use
            // the client filename extension here; individual processors still
            // validate their own document/audio/image inputs before use.
            'file' => [
                'nullable',
                'file',
                'max:20480',
                static function (string $attribute, mixed $value, \Closure $fail): void {
                    if (! $value instanceof \Illuminate\Http\UploadedFile) {
                        return;
                    }

                    $extension = strtolower((string) $value->getClientOriginalExtension());
                    $allowed = ['pdf', 'doc', 'docx', 'txt', 'mp3', 'wav', 'm4a', 'jpg', 'jpeg', 'png', 'gif', 'webp'];
                    if (! in_array($extension, $allowed, true)) {
                        $fail('รองรับเฉพาะไฟล์ PDF, DOC, DOCX, TXT, MP3, WAV, M4A และไฟล์รูปภาพ');
                    }
                },
            ],
            'storage_path' => ['nullable', 'string', 'max:255'],
            'original_name' => ['nullable', 'string', 'max:255'],
            'mime_type' => ['nullable', 'string', 'max:255'],
            'file_size' => ['nullable', 'integer', 'min:0'],
            'file_type' => ['nullable', 'in:pdf,word,audio,image,other'],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator) {
            if (! $this->hasFile('file') && ! $this->filled('storage_path')) {
                $validator->errors()->add('file', 'ต้องส่งไฟล์หรือ storage_path อย่างน้อยหนึ่งรายการ');
            }
        });
    }
}
