<?php

namespace App\Services;

use App\Models\Contact;
use App\Models\ContactBrandRelation;
use App\Models\ContactListMember;
use App\Models\Import;
use App\Models\SuppressionList;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ContactImportService
{
    /**
     * Detecta automaticamente o delimitador de um CSV
     * (vírgula, ponto-e-vírgula ou tab).
     */
    public function detectDelimiter(string $firstLine): string
    {
        $delimiters = [',', ';', "\t", '|'];
        $counts = array_map(fn ($d) => substr_count($firstLine, $d), $delimiters);
        $max = max($counts);
        if ($max === 0) return ',';
        return $delimiters[array_search($max, $counts)];
    }

    /**
     * Mapeia cabeçalhos do CSV para campos internos.
     * Tolerante a maiúsculas/minúsculas e variantes comuns em PT/EN.
     */
    public function mapHeaders(array $headers): array
    {
        $map = [
            'email'      => ['email', 'e-mail', 'e_mail', 'correo', 'mail'],
            'first_name' => ['first_name', 'first name', 'firstname', 'nome', 'name', 'nome_proprio', 'primeiro_nome'],
            'last_name'  => ['last_name', 'last name', 'lastname', 'apelido', 'surname', 'sobrenome', 'ultimo_nome'],
            'phone'      => ['phone', 'telefone', 'telemovel', 'mobile', 'telefon', 'tel'],
            'company'    => ['company', 'empresa', 'organization', 'org', 'companhia'],
        ];

        $result = [];
        foreach ($headers as $i => $header) {
            $normalised = strtolower(trim(str_replace([' ', '-'], '_', $header)));
            foreach ($map as $field => $aliases) {
                if (in_array($normalised, $aliases)) {
                    $result[$field] = $i;
                    break;
                }
            }
        }
        return $result;
    }

    /**
     * Processa um chunk de linhas CSV.
     * Retorna contadores: imported, skipped, failed.
     *
     * @param  array<int, array<string>>  $rows   Linhas de CSV já parseadas
     * @param  array<string, int>  $fieldMap     Mapeamento campo → índice coluna
     */
    public function processChunk(array $rows, array $fieldMap, Import $import): array
    {
        $imported = 0;
        $skipped  = 0;
        $failed   = 0;
        $brandId  = $import->brand_id;
        $listId   = $import->list_id;

        foreach ($rows as $row) {
            try {
                $emailIdx = $fieldMap['email'] ?? null;
                if ($emailIdx === null || empty($row[$emailIdx])) {
                    $failed++;
                    continue;
                }

                $email     = strtolower(trim($row[$emailIdx]));
                $emailHash = hash('sha256', $email);

                // Validação mínima de formato
                if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    $failed++;
                    continue;
                }

                // Skip se suprimido para esta marca
                if (SuppressionList::isSuppressed($email, $brandId)) {
                    $skipped++;
                    continue;
                }

                DB::transaction(function () use (
                    $row, $fieldMap, $email, $emailHash, $brandId, $listId,
                    &$imported, &$skipped
                ) {
                    $contact = Contact::firstOrCreate(
                        ['email' => $email],
                        [
                            'email_hash' => $emailHash,
                            'first_name' => $this->field($row, $fieldMap, 'first_name'),
                            'last_name'  => $this->field($row, $fieldMap, 'last_name'),
                            'phone'      => $this->field($row, $fieldMap, 'phone'),
                            'company'    => $this->field($row, $fieldMap, 'company'),
                        ]
                    );

                    $relation = ContactBrandRelation::firstOrCreate(
                        ['contact_id' => $contact->id, 'brand_id' => $brandId],
                        ['status' => 'active', 'consent_given' => false]
                    );

                    // Adicionar à lista-alvo (se aplicável)
                    if ($listId) {
                        $member = ContactListMember::firstOrCreate(
                            ['contact_id' => $contact->id, 'list_id' => $listId],
                            ['brand_id' => $brandId, 'status' => 'active', 'subscribed_at' => now()]
                        );

                        if ($member->wasRecentlyCreated) {
                            $imported++;
                        } else {
                            $skipped++; // já era membro
                        }
                    } else {
                        $imported++;
                    }
                });
            } catch (\Throwable $e) {
                Log::warning("Import chunk error: {$e->getMessage()}", [
                    'import_id' => $import->id,
                    'row'       => $row,
                ]);
                $failed++;
            }
        }

        return compact('imported', 'skipped', 'failed');
    }

    private function field(array $row, array $fieldMap, string $field): ?string
    {
        $idx = $fieldMap[$field] ?? null;
        return ($idx !== null && isset($row[$idx]) && trim($row[$idx]) !== '')
            ? trim($row[$idx])
            : null;
    }
}
