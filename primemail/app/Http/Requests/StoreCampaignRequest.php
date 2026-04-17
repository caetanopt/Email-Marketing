<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreCampaignRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'name'          => ['required', 'string', 'max:200'],
            'subject'       => ['required', 'string', 'max:998'],
            'preview_text'  => ['nullable', 'string', 'max:255'],
            'from_name'     => ['required', 'string', 'max:100'],
            'from_email'    => ['required', 'email', 'max:255'],
            'reply_to'      => ['nullable', 'email', 'max:255'],
            'template_id'   => ['nullable', 'integer', 'exists:templates,id'],
            'mjml_source'   => ['nullable', 'string', 'min:10'],
            'content_text'  => ['nullable', 'string'],
            'list_ids'      => ['required', 'array', 'min:1'],
            'list_ids.*'    => ['integer', 'exists:contact_lists,id'],
            'scheduled_at'  => ['nullable', 'date', 'after:now'],
        ];
    }

    public function messages(): array
    {
        return [
            'list_ids.required' => 'Selecciona pelo menos uma lista ou segmento.',
            'list_ids.min'      => 'Selecciona pelo menos uma lista.',
        ];
    }
}
