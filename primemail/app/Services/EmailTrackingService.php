<?php

namespace App\Services;

use App\Models\CampaignRecipient;

class EmailTrackingService
{
    /**
     * Injects open-tracking pixel and rewrites links with click-tracking URLs.
     */
    public function instrument(string $html, CampaignRecipient $recipient): string
    {
        $token = $recipient->tracking_token;

        $html = $this->rewriteLinks($html, $token);
        $html = $this->injectPixel($html, $token);

        return $html;
    }

    private function rewriteLinks(string $html, string $token): string
    {
        // Replace href="..." inside anchor tags, skipping unsubscribe links (already personalised)
        return preg_replace_callback(
            '/<a\s[^>]*href=["\']([^"\'#][^"\']*)["\'][^>]*>/i',
            function (array $matches) use ($token) {
                $original = $matches[1];

                // Skip mailto:, #anchors, and our own tracking/unsubscribe URLs
                if (
                    str_starts_with($original, 'mailto:') ||
                    str_starts_with($original, '#') ||
                    str_contains($original, '/track/') ||
                    str_contains($original, '/unsubscribe/')
                ) {
                    return $matches[0];
                }

                $encoded   = urlencode($original);
                $trackUrl  = url("/track/click/{$token}/{$encoded}");
                return str_replace($original, $trackUrl, $matches[0]);
            },
            $html
        );
    }

    private function injectPixel(string $html, string $token): string
    {
        $pixelUrl = url("/track/open/{$token}");
        $pixel    = "<img src=\"{$pixelUrl}\" width=\"1\" height=\"1\" alt=\"\" style=\"display:none\" />";

        // Inject just before </body>
        if (str_contains($html, '</body>')) {
            return str_replace('</body>', $pixel . '</body>', $html);
        }

        return $html . $pixel;
    }
}
