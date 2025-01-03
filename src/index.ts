import { URL } from 'url';
import fs from 'fs';
import { parse as parseQueryString } from 'querystring';
import { join } from 'path';

const REFERERS = JSON.parse(
    fs.readFileSync(join(__dirname, '../data/referers-latest.json'), 'utf8')
);

interface RefererConfig {
    parameters?: string[];
    domains: string[];
}

interface RefererSource {
    [medium: string]: {
        [refererName: string]: RefererConfig;
    };
}

interface RefererValue {
    name: string;
    medium: string;
    params?: string[];
}

interface RefererDict {
    [domain: string]: RefererValue;
}

interface RefererResult {
    name: string;
    medium: string;
    params?: string[];
}

function loadReferers(source: RefererSource): RefererDict {
    const referersDict: RefererDict = {};

    for (const medium in source) {
        const confList = source[medium];

        for (const refererName in confList) {
            const config = confList[refererName];
            const params = config.parameters?.map(p => p.toLowerCase());

            config.domains.forEach(domain => {
                referersDict[domain] = {
                    name: refererName,
                    medium: medium,
                };
                if (params) {
                    referersDict[domain]['params'] = params;
                }
            });
        }
    }
    return referersDict;
}

class Referer {
    known: boolean;
    referer: string | null;
    medium: string;
    searchParameter: string | null;
    searchTerm: string | null;
    uri: URL;
    private referers: RefererDict;

    constructor(
        refererUrl: string,
        currentUrl?: string,
        referers?: RefererSource
    ) {
        this.known = false;
        this.referer = null;
        this.medium = 'unknown';
        this.searchParameter = null;
        this.searchTerm = null;
        this.referers = referers
            ? loadReferers(referers)
            : loadReferers(REFERERS);

        const refUri = new URL(refererUrl);
        const refHost = refUri.hostname;
        this.known = ['http:', 'https:'].includes(refUri.protocol);
        this.uri = refUri;

        if (!this.known) return;

        if (currentUrl) {
            const currUri = new URL(currentUrl);
            const currHost = currUri.hostname;

            if (currHost === refHost) {
                this.medium = 'internal';
                return;
            }
        }

        const referer = this.lookupReferer(refHost, refUri.pathname, true);
        if (!referer) {
            const fallbackReferer = this.lookupReferer(
                refHost,
                refUri.pathname,
                false
            );
            if (!fallbackReferer) {
                this.medium = 'unknown';
                return;
            }
            this.processReferer(fallbackReferer, refUri);
        } else {
            this.processReferer(referer, refUri);
        }
    }

    private processReferer(referer: RefererResult, refUri: URL): void {
        this.referer = referer.name;
        this.medium = referer.medium;

        if (referer.medium === 'search' && referer.params) {
            const queryParams = parseQueryString(refUri.search.slice(1));

            for (const [param, val] of Object.entries(queryParams)) {
                if (
                    referer.params.includes(param.toLowerCase()) &&
                    typeof val === 'string'
                ) {
                    this.searchParameter = param;
                    this.searchTerm = val;
                }
            }
        }
    }

    private lookupReferer(
        refHost: string,
        refPath: string,
        includePath: boolean
    ): RefererResult | null {
        let referer: RefererValue | null = null;

        if (includePath) referer = this.referers[refHost + refPath];
        else referer = this.referers[refHost];

        if (!referer && includePath) {
            const pathParts = refPath.split('/');
            if (pathParts.length > 1) {
                try {
                    referer = this.referers[refHost + '/' + pathParts[1]];
                } catch (e) {}
            }
        }

        if (!referer) {
            const idx = refHost.indexOf('.');
            if (idx === -1) return null;

            const slicedHost = refHost.slice(idx + 1);
            return this.lookupReferer(slicedHost, refPath, includePath);
        }

        return referer;
    }
}

export default Referer;
