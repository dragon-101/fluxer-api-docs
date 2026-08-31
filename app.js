// ============================================================
//  app.js - Fluxer API Documentation
//  Shows full schema only for 2xx responses.
// ============================================================

(function() {
    'use strict';

    let spec = null;

    // DOM refs
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebarClose = document.getElementById('sidebar-close');
    const navContainer = document.getElementById('sidebar-nav').querySelector('ul');
    const contentArea = document.getElementById('rendered-content');
    const spinner = document.getElementById('loading-spinner');
    const searchInput = document.getElementById('search-input');
    const searchModal = document.getElementById('search-modal');
    const searchModalInput = document.getElementById('search-modal-input');
    const searchResults = document.getElementById('search-results');
    const searchModalClose = document.getElementById('search-modal-close');
    const themeSelect = document.getElementById('theme-select');

    // ---------- Theme Manager ----------
    const ThemeManager = {
        init() {
            const saved = localStorage.getItem('fluxer-theme');
            const theme = saved || 'dark';
            this.setTheme(theme);
            themeSelect.value = theme;
            themeSelect.addEventListener('change', (e) => {
                this.setTheme(e.target.value);
            });
        },
        setTheme(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('fluxer-theme', theme);
            themeSelect.value = theme;
        }
    };

    // ---------- Router ----------
    const Router = {
        currentTag: null,

        init() {
            window.addEventListener('hashchange', () => this.handleRoute());
            this.handleRoute();
        },

        handleRoute() {
            const hash = window.location.hash.slice(1) || 'intro';
            if (hash.startsWith('tag/')) {
                const tag = decodeURIComponent(hash.substring(4));
                this.navigateToTag(tag);
            } else {
                this.showIntro();
            }
        },

        navigateToTag(tag) {
            this.currentTag = tag;
            if (spec) {
                renderer.renderTag(tag);
                this.updateActiveNav(tag);
            } else {
                const checkSpec = setInterval(() => {
                    if (spec) {
                        clearInterval(checkSpec);
                        renderer.renderTag(tag);
                        this.updateActiveNav(tag);
                    }
                }, 100);
            }
        },

        showIntro() {
            if (spec) {
                renderer.renderIntro();
            } else {
                const checkSpec = setInterval(() => {
                    if (spec) {
                        clearInterval(checkSpec);
                        renderer.renderIntro();
                    }
                }, 100);
            }
            this.clearActiveNav();
        },

        updateActiveNav(tag) {
            const links = navContainer.querySelectorAll('a');
            links.forEach(link => {
                link.classList.toggle('active', link.dataset.tag === tag);
            });
        },

        clearActiveNav() {
            navContainer.querySelectorAll('a').forEach(link => link.classList.remove('active'));
        }
    };

    // ---------- Renderer ----------
    const renderer = {
        // Deeply resolve all $refs in a schema (including nested ones)
        deepResolveSchema(schema, visited = new Set()) {
            if (!schema || typeof schema !== 'object') return schema;
            if (visited.has(schema)) return schema;
            visited.add(schema);
            if (Array.isArray(schema)) {
                return schema.map(item => this.deepResolveSchema(item, visited));
            }
            if (schema.$ref) {
                const resolved = this.resolveRef(schema.$ref);
                if (resolved) {
                    return this.deepResolveSchema(resolved, visited);
                }
                return { $ref: schema.$ref, note: 'Schema not found' };
            }
            const result = {};
            for (const [key, value] of Object.entries(schema)) {
                if (['oneOf', 'anyOf', 'allOf'].includes(key) && Array.isArray(value)) {
                    result[key] = value.map(item => this.deepResolveSchema(item, visited));
                } else if (typeof value === 'object' && value !== null) {
                    result[key] = this.deepResolveSchema(value, visited);
                } else {
                    result[key] = value;
                }
            }
            return result;
        },

        resolveRef(refPath) {
            if (!refPath || typeof refPath !== 'string') return null;
            const parts = refPath.split('/');
            if (parts.length < 3) return null;
            const schemaName = parts[parts.length - 1];
            if (spec.components && spec.components.schemas && spec.components.schemas[schemaName]) {
                return spec.components.schemas[schemaName];
            }
            return null;
        },

        // ----- Syntax highlighting for JSON -----
        highlightJSON(json) {
            if (typeof json !== 'string') json = JSON.stringify(json, null, 2);
            let html = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html = html.replace(/"([^"]+)":/g, '<span class="hljs-key">"$1"</span>:');
            html = html.replace(/: "([^"]*)"/g, (match, p1) => `: <span class="hljs-string">"${p1}"</span>`);
            html = html.replace(/: (\d+\.?\d*)/g, (match, p1) => `: <span class="hljs-number">${p1}</span>`);
            html = html.replace(/: (true|false|null)/g, (match, p1) => `: <span class="hljs-boolean">${p1}</span>`);
            return html;
        },

        // ----- Render a schema as a table (for object definitions) -----
        renderSchemaTable(schema, modelName) {
            if (!schema || typeof schema !== 'object') return '';
            if (schema.$ref) {
                const resolved = this.resolveRef(schema.$ref);
                if (resolved) return this.renderSchemaTable(resolved, modelName);
                return `<div class="schema-notice">Referenced schema not found: ${schema.$ref}</div>`;
            }
            const props = schema.properties || {};
            const required = schema.required || [];
            if (Object.keys(props).length === 0) {
                return `<div class="schema-notice">${schema.type || 'object'} – no properties defined</div>`;
            }

            let html = `<table class="param-table schema-table">
                            <thead>
                                <tr>
                                    <th>Field</th>
                                    <th>Type</th>
                                    <th>Description</th>
                                </tr>
                            </thead>
                            <tbody>`;
            let footnoteCount = 0;
            const footnotes = [];
            for (const [propName, propSchema] of Object.entries(props)) {
                let typeStr = this.getTypeString(propSchema);
                const isRequired = required.includes(propName);
                let desc = propSchema.description || '';
                let fieldName = propName;
                if (!isRequired) {
                    footnoteCount++;
                    fieldName += `<sup>${footnoteCount}</sup>`;
                    footnotes.push(`<sup>${footnoteCount}</sup> Optional.`);
                }
                const refName = this.extractRefName(propSchema);
                if (refName && spec.schemas && spec.schemas[refName]) {
                    typeStr = `<a href="#model-${refName}" class="type-link">${refName}</a>`;
                } else if (propSchema.type === 'array' && propSchema.items) {
                    const itemRef = this.extractRefName(propSchema.items);
                    if (itemRef && spec.schemas && spec.schemas[itemRef]) {
                        typeStr = `array of <a href="#model-${itemRef}" class="type-link">${itemRef}</a>`;
                    } else {
                        typeStr = `array of ${propSchema.items.type || 'object'}`;
                    }
                }
                html += `<tr>
                            <td class="param-name">${fieldName}</td>
                            <td class="param-type">${typeStr}</td>
                            <td>${desc}</td>
                        </tr>`;
            }
            html += `</tbody></table>`;
            if (footnotes.length > 0) {
                html += `<div class="footnotes">${footnotes.join(' ')}</div>`;
            }
            return html;
        },

        getTypeString(schema) {
            if (!schema) return 'any';
            if (schema.type) return schema.type;
            if (schema.$ref) {
                const refName = this.extractRefName(schema);
                return refName || 'object';
            }
            if (schema.oneOf) {
                const types = schema.oneOf.map(s => this.getTypeString(s));
                return types.join(' or ');
            }
            if (schema.anyOf) {
                const types = schema.anyOf.map(s => this.getTypeString(s));
                return types.join(' or ');
            }
            return 'object';
        },

        extractRefName(schema) {
            if (!schema) return null;
            if (schema.$ref) {
                const parts = schema.$ref.split('/');
                return parts[parts.length - 1];
            }
            if (schema.items && schema.items.$ref) {
                const parts = schema.items.$ref.split('/');
                return parts[parts.length - 1];
            }
            return null;
        },

        renderIntro() {
            const tags = Object.keys(spec.tags || {});
            let html = `<h1 class="page-title">Welcome to Fluxer API</h1>
                        <p class="page-description">Explore the endpoints below. Select a tag from the sidebar to see its operations.</p>
                        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;">`;
            tags.forEach(tag => {
                const count = (spec.tags[tag] || []).length;
                html += `<a href="#tag/${encodeURIComponent(tag)}" style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:1rem;text-decoration:none;color:var(--text-primary);transition:transform 0.15s;display:block;">
                            <strong style="font-family:var(--font-mono);color:var(--accent);">${tag}</strong>
                            <div style="font-size:0.85rem;color:var(--text-muted);">${count} endpoint${count!==1?'s':''}</div>
                        </a>`;
            });
            html += `</div>`;
            this.renderContent(html);
            Router.clearActiveNav();
        },

        renderTag(tag) {
            const endpoints = spec.tags[tag];
            if (!endpoints || endpoints.length === 0) {
                this.renderContent(`<h1 class="page-title">${tag}</h1><p class="page-description">No endpoints found for this tag.</p>`);
                return;
            }

            let html = `<h1 class="page-title">${tag}</h1>
                        <p class="page-description">${endpoints.length} endpoint${endpoints.length>1?'s':''}</p>`;

            endpoints.forEach((ep, idx) => {
                html += this.renderEndpointCard(ep, idx);
            });

            if (spec.schemas && Object.keys(spec.schemas).length > 0) {
                html += `<h2 style="margin-top:2.5rem;font-family:var(--font-mono);">Objects</h2>`;
                for (const [name, schema] of Object.entries(spec.schemas)) {
                    html += this.renderModelCard(name, schema);
                }
            }

            this.renderContent(html);
            Router.updateActiveNav(tag);
        },

        renderEndpointCard(ep, index) {
            const method = ep.method || 'GET';
            const path = ep.path || '';
            const summary = ep.summary || ep.description || '';
            const params = ep.parameters || [];
            const requestBody = ep.requestBody;
            const responses = ep.responses || {};

            const methodClass = method.toLowerCase();

            let html = `<div class="endpoint-card" id="endpoint-${index}">
                            <div class="endpoint-header">
                                <span class="endpoint-method ${methodClass}">${method}</span>
                                <span class="endpoint-path">${path}</span>
                            </div>
                            <div class="endpoint-summary">${summary}</div>
                            <div class="endpoint-details">`;

            // Parameters
            if (params.length > 0) {
                html += `<details>
                            <summary>Parameters (${params.length})</summary>
                            <table class="param-table">
                                <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
                                <tbody>`;
                params.forEach(p => {
                    const name = p.name || '';
                    const type = p.schema?.type || p.type || 'string';
                    const required = p.required ? 'Yes' : 'No';
                    const desc = p.description || '';
                    html += `<tr>
                                <td class="param-name">${name}</td>
                                <td class="param-type">${type}</td>
                                <td class="param-required">${required}</td>
                                <td>${desc}</td>
                            </tr>`;
                });
                html += `</tbody></table></details>`;
            }

            // Request Body - render as JSON with syntax highlighting
            if (requestBody) {
                const content = requestBody.content || {};
                const jsonContent = content['application/json'] || content['*/*'] || {};
                let schema = jsonContent.schema || {};
                const resolvedSchema = this.deepResolveSchema(schema);
                const jsonStr = JSON.stringify(resolvedSchema, null, 2);
                const highlighted = this.highlightJSON(jsonStr);
                html += `<details>
                            <summary>Request Body</summary>
                            <div class="code-block">
                                <pre><code>${highlighted}</code></pre>
                            </div>
                        </details>`;
            }

            // Responses - only show schema for 2xx
            const respKeys = Object.keys(responses);
            if (respKeys.length > 0) {
                html += `<details>
                            <summary>Responses (${respKeys.length})</summary>`;
                respKeys.forEach(code => {
                    const resp = responses[code];
                    const desc = resp.description || '';
                    const content = resp.content || {};
                    const jsonContent = content['application/json'] || content['*/*'] || {};
                    let schema = jsonContent.schema || {};
                    const resolvedSchema = this.deepResolveSchema(schema);
                    const jsonStr = Object.keys(resolvedSchema).length ? JSON.stringify(resolvedSchema, null, 2) : '';
                    const highlighted = jsonStr ? this.highlightJSON(jsonStr) : '';

                    // Only render schema for 2xx responses
                    const isSuccess = code.startsWith('2');
                    const schemaHtml = (isSuccess && highlighted) 
                        ? `<div class="code-block"><pre><code>${highlighted}</code></pre></div>` 
                        : '';

                    html += `<div class="response-item">
                                <div class="response-status"><strong>${code}</strong> ${desc}</div>
                                ${schemaHtml}
                            </div>`;
                });
                html += `</details>`;
            }

            html += `</div></div>`;
            return html;
        },

        renderModelCard(name, schema) {
            const resolved = this.deepResolveSchema(schema);
            const tableHtml = this.renderSchemaTable(resolved, name);
            return `<div class="model-card" id="model-${name}">
                        <div class="model-name">${name}</div>
                        ${tableHtml}
                    </div>`;
        },

        renderContent(html) {
            contentArea.innerHTML = html;
            contentArea.style.display = 'block';
            spinner.style.display = 'none';
        },

        showLoading() {
            contentArea.style.display = 'none';
            spinner.style.display = 'flex';
        },

        hideLoading() {
            spinner.style.display = 'none';
            contentArea.style.display = 'block';
        }
    };

    // ---------- Search Engine ----------
    const SearchEngine = {
        index: [],

        buildIndex() {
            if (!spec || !spec.tags) return;
            this.index = [];
            for (const [tag, endpoints] of Object.entries(spec.tags)) {
                if (!Array.isArray(endpoints)) continue;
                endpoints.forEach(ep => {
                    this.index.push({
                        tag,
                        method: ep.method,
                        path: ep.path,
                        summary: ep.summary || ep.description || '',
                        fullText: `${ep.method} ${ep.path} ${ep.summary || ''} ${ep.description || ''}`.toLowerCase()
                    });
                });
            }
        },

        search(query) {
            const q = query.trim().toLowerCase();
            if (!q) return [];
            const results = this.index.filter(item => item.fullText.includes(q));
            results.sort((a, b) => {
                const aExact = a.fullText === q ? 1 : 0;
                const bExact = b.fullText === q ? 1 : 0;
                if (aExact !== bExact) return bExact - aExact;
                return a.fullText.length - b.fullText.length;
            });
            return results.slice(0, 20);
        },

        renderResults(results, container) {
            container.innerHTML = '';
            if (results.length === 0) {
                container.innerHTML = '<div class="search-no-results">No endpoints found.</div>';
                return;
            }
            results.forEach(r => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.innerHTML = `
                    <span class="result-method">${r.method}</span>
                    <span class="result-path">${r.path}</span>
                    <span class="result-desc">${r.summary}</span>
                `;
                div.addEventListener('click', () => {
                    window.location.hash = `tag/${encodeURIComponent(r.tag)}`;
                    searchModal.classList.remove('active');
                    Router.handleRoute();
                });
                container.appendChild(div);
            });
        }
    };

    // ---------- Load Spec ----------
    function loadSpec() {
        if (typeof FLUXER_SPEC !== 'undefined' && FLUXER_SPEC) {
            spec = FLUXER_SPEC;
            onSpecLoaded();
            return;
        }
        renderer.showLoading();
        fetch('https://api.fluxer.app/openapi.json')
            .then(res => res.json())
            .then(data => {
                spec = data;
                onSpecLoaded();
            })
            .catch(err => {
                console.error('Failed to load spec:', err);
                renderer.renderContent('<h1>Error</h1><p>Could not load API specification. Please try again later.</p>');
                spinner.style.display = 'none';
            });
    }

    function onSpecLoaded() {
        const paths = spec.paths || {};
        const tagMap = {};
        for (const [path, methods] of Object.entries(paths)) {
            for (const [method, operation] of Object.entries(methods)) {
                if (typeof operation !== 'object' || operation === null) continue;
                const tags = operation.tags || ['Uncategorized'];
                tags.forEach(tag => {
                    if (!tagMap[tag]) tagMap[tag] = [];
                    tagMap[tag].push({
                        method: method.toUpperCase(),
                        path,
                        summary: operation.summary || '',
                        description: operation.description || '',
                        parameters: operation.parameters || [],
                        requestBody: operation.requestBody || null,
                        responses: operation.responses || {}
                    });
                });
            }
        }
        spec.tags = tagMap;
        spec.schemas = (spec.components && spec.components.schemas) ? spec.components.schemas : {};

        buildSidebar();
        SearchEngine.buildIndex();
        renderer.hideLoading();
        Router.init();
    }

    function buildSidebar() {
        navContainer.innerHTML = '';
        const tags = Object.keys(spec.tags || {}).sort();
        tags.forEach(tag => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = `#tag/${encodeURIComponent(tag)}`;
            a.textContent = tag;
            a.dataset.tag = tag;
            li.appendChild(a);
            navContainer.appendChild(li);
        });
    }

    // ---------- UI Event Handlers ----------
    function toggleSidebar() {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    }

    sidebarToggle.addEventListener('click', toggleSidebar);
    sidebarClose.addEventListener('click', closeSidebar);
    overlay.addEventListener('click', closeSidebar);

    searchInput.addEventListener('click', () => {
        searchModal.classList.add('active');
        searchModalInput.focus();
        searchResults.innerHTML = '';
    });

    searchModalClose.addEventListener('click', () => {
        searchModal.classList.remove('active');
    });
    searchModal.addEventListener('click', (e) => {
        if (e.target === searchModal) {
            searchModal.classList.remove('active');
        }
    });

    let searchTimeout;
    searchModalInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value;
        searchTimeout = setTimeout(() => {
            const results = SearchEngine.search(query);
            SearchEngine.renderResults(results, searchResults);
            if (results.length > 0) {
                const first = searchResults.querySelector('.search-result-item');
                if (first) first.classList.add('selected');
            }
        }, 200);
    });

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            if (searchModal.classList.contains('active')) {
                searchModal.classList.remove('active');
            } else {
                searchModal.classList.add('active');
                searchModalInput.focus();
                searchResults.innerHTML = '';
            }
        }
        if (e.key === 'Escape' && searchModal.classList.contains('active')) {
            searchModal.classList.remove('active');
        }
        if (searchModal.classList.contains('active') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            const items = searchResults.querySelectorAll('.search-result-item');
            if (items.length === 0) return;
            let idx = -1;
            items.forEach((el, i) => { if (el.classList.contains('selected')) idx = i; });
            if (e.key === 'ArrowDown') {
                idx = (idx + 1) % items.length;
            } else {
                idx = (idx - 1 + items.length) % items.length;
            }
            items.forEach(el => el.classList.remove('selected'));
            items[idx].classList.add('selected');
            items[idx].scrollIntoView({ block: 'nearest' });
            e.preventDefault();
        }
        if (e.key === 'Enter' && searchModal.classList.contains('active')) {
            const selected = searchResults.querySelector('.search-result-item.selected');
            if (selected) selected.click();
        }
    });

    ThemeManager.init();
    loadSpec();
})();