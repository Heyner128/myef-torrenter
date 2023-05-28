import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";

const fastify = Fastify().withTypeProvider<TypeBoxTypeProvider>();

export default fastify;
