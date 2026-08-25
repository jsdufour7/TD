CREATE TABLE "agent_model_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_key" text NOT NULL,
	"model_id" uuid,
	"policy" text DEFAULT 'BALANCED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_model_bindings" ADD CONSTRAINT "agent_model_bindings_org_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_model_bindings" ADD CONSTRAINT "agent_model_bindings_model_id_model_definitions_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model_definitions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_model_bindings_org_agent_idx" ON "agent_model_bindings" USING btree ("organization_id","agent_key");
