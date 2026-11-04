-- find() fetches edges touching the top-k nodes (listEdgesForNodes); without these it seq-scans every edge.
CREATE INDEX IF NOT EXISTS edge_from_node_idx ON edge (from_node_id);
CREATE INDEX IF NOT EXISTS edge_to_node_idx ON edge (to_node_id);
CREATE INDEX IF NOT EXISTS edge_domain_version_idx ON edge (domain, map_version);
