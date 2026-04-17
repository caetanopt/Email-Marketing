<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreTemplateRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'name'         => ['required', 'string', 'max:150'],
            'description'  => ['nullable', 'string', 'max:1000'],
            'mjml_source'  => ['required', 'string', 'min:10'],
            'content_text' => ['nullable', 'string'],
            'is_shared'    => ['boolean'],
        ];
    }
}
