<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\CampaignRecipient;
use App\Models\Contact;
use App\Models\EmailEvent;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function __invoke(): Response
    {
        $brandId = session('active_brand_id');
        $since   = now()->subDays(30);

        $activeContacts = Contact::withoutGlobalScopes()
            ->where('brand_id', $brandId)
            ->where('status', 'active')
            ->count();

        $sentCampaigns30d = Campaign::withoutGlobalScopes()
            ->where('brand_id', $brandId)
            ->where('status', 'sent')
            ->where('sent_at', '>=', $since)
            ->count();

        $emailsSent30d = CampaignRecipient::withoutGlobalScopes()
            ->where('brand_id', $brandId)
            ->where('status', 'sent')
            ->where('sent_at', '>=', $since)
            ->count();

        // Recent campaigns (last 10 sent) with open/click rates
        $recentCampaigns = Campaign::withoutGlobalScopes()
            ->where('brand_id', $brandId)
            ->where('status', 'sent')
            ->orderByDesc('sent_at')
            ->limit(10)
            ->get(['id', 'name', 'subject', 'sent_at', 'actual_recipients'])
            ->map(function ($c) use ($brandId) {
                $sent   = $c->actual_recipients ?: 1;
                $opens  = EmailEvent::withoutGlobalScopes()
                    ->where('campaign_id', $c->id)
                    ->where('event_type', 'open')
                    ->distinct('contact_id')
                    ->count('contact_id');
                $clicks = EmailEvent::withoutGlobalScopes()
                    ->where('campaign_id', $c->id)
                    ->where('event_type', 'click')
                    ->distinct('contact_id')
                    ->count('contact_id');

                return [
                    'id'         => $c->id,
                    'name'       => $c->name,
                    'subject'    => $c->subject,
                    'sent_at'    => $c->sent_at,
                    'open_rate'  => $sent > 0 ? round($opens  / $sent * 100, 1) : 0,
                    'click_rate' => $sent > 0 ? round($clicks / $sent * 100, 1) : 0,
                ];
            });

        // Aggregate rates from last 10 campaigns
        $avgOpenRate  = $recentCampaigns->avg('open_rate')  ?? 0;
        $avgClickRate = $recentCampaigns->avg('click_rate') ?? 0;

        // Bounce rate across last 30 days
        $totalSent30d   = max($emailsSent30d, 1);
        $bounced30d     = CampaignRecipient::withoutGlobalScopes()
            ->where('brand_id', $brandId)
            ->where('status', 'bounced')
            ->where('sent_at', '>=', $since)
            ->count();

        $bounceRate = round($bounced30d / $totalSent30d * 100, 1);

        return Inertia::render('Dashboard', [
            'stats' => [
                'active_contacts'    => $activeContacts,
                'sent_campaigns_30d' => $sentCampaigns30d,
                'emails_sent_30d'    => $emailsSent30d,
                'avg_open_rate'      => round($avgOpenRate, 1),
                'avg_click_rate'     => round($avgClickRate, 1),
                'bounce_rate'        => $bounceRate,
            ],
            'recentCampaigns' => $recentCampaigns,
        ]);
    }
}
