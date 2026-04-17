<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreContactRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'email'      => ['required', 'email:rfc,dns', 'max:255'],
            'first_name' => ['nullable', 'string', 'max:100'],
            'last_name'  => ['nullable', 'string', 'max:100'],
            'phone'      => ['nullable', 'string', 'max:30'],
            'company'    => ['nullable', 'string', 'max:150'],
            'consent'    => ['boolean'],
            'list_ids'   => ['nullable', 'array'],
            'list_ids.*' => ['integer', 'exists:contact_lists,id'],
        ];
    }
}
